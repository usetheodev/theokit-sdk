/**
 * `git_diff` — built-in tool for coding agents.
 *
 * Returns the unified diff of the working tree (or staged changes when
 * `cached=true`). Implemented as a thin `git diff` subprocess wrapper
 * with a couple of hard limits:
 *
 *   - 30s wall clock timeout (kills the process group on expiry)
 *   - 5 MB stdout cap (truncate + flag `truncated=true`)
 *   - Path scope validated through `safePathJoin` + `assertNoSymlinkEscape`
 *
 * Result shape (always a JSON string):
 *   - `{ ok: true, diff: string, truncated?: boolean }`
 *   - `{ ok: false, error: 'not_a_repo' | 'path_traversal' | 'timeout' }`
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { defineTool } from "../define-tool.js";
import {
  assertNoSymlinkEscape,
  ForbiddenPathError,
  PathTraversalError,
  safePathJoin,
} from "../internal/security/path-guard.js";
import type { CustomTool } from "../types/agent.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_STDOUT_BYTES = 5 * 1024 * 1024;

export interface CreateGitDiffToolOptions {
  projectRoot: string;
  timeoutMs?: number;
  maxStdoutBytes?: number;
}

export function createGitDiffTool(opts: CreateGitDiffToolOptions): CustomTool {
  const {
    projectRoot,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxStdoutBytes = DEFAULT_MAX_STDOUT_BYTES,
  } = opts;

  return defineTool({
    name: "git_diff",
    description:
      "Return the unified diff of the project's working tree (or staged " +
      "changes when cached=true). Scoped to a single file when 'path' is " +
      "provided. Requires the project to be a git repository. Returns " +
      "{ ok, diff, truncated? } or { ok: false, error }.",
    inputSchema: z.object({
      path: z.string().optional().describe("Optional project-relative file or dir scope."),
      cached: z
        .boolean()
        .optional()
        .describe("If true, show staged changes (git diff --cached). Default false."),
    }),
    handler: async ({ path, cached }) => {
      if (!existsSync(join(projectRoot, ".git"))) {
        return JSON.stringify({ ok: false, error: "not_a_repo" });
      }

      // Validate path scope if provided
      if (path !== undefined && path !== "") {
        try {
          const abs = safePathJoin(projectRoot, path);
          assertNoSymlinkEscape(abs, projectRoot);
        } catch (err) {
          if (err instanceof PathTraversalError || err instanceof ForbiddenPathError) {
            return JSON.stringify({ ok: false, error: "path_traversal", path });
          }
          throw err;
        }
      }

      const args = ["diff", "--no-color"];
      if (cached === true) args.push("--cached");
      if (path !== undefined && path !== "") {
        args.push("--", path);
      }

      const result = await runGitProcess(projectRoot, args, timeoutMs, maxStdoutBytes);
      if (result.kind === "timeout") {
        return JSON.stringify({ ok: false, error: "timeout", timeoutMs });
      }
      if (result.kind === "error") {
        return JSON.stringify({ ok: false, error: "git_failed", stderr: result.stderr });
      }
      return JSON.stringify({
        ok: true,
        diff: result.stdout,
        truncated: result.truncated,
      });
    },
  });
}

type GitProcessResult =
  | { kind: "ok"; stdout: string; truncated: boolean }
  | { kind: "error"; stderr: string }
  | { kind: "timeout" };

function runGitProcess(
  cwd: string,
  args: string[],
  timeoutMs: number,
  maxStdoutBytes: number,
): Promise<GitProcessResult> {
  return new Promise((resolve) => {
    // Detached process group so we can kill the whole tree on timeout (EC-7).
    const child = spawn("git", args, { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let truncated = false;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        // Kill the process group (PGID = -child.pid).
        process.kill(-(child.pid ?? 0), "SIGKILL");
      } catch {
        /* already dead */
      }
      resolve({ kind: "timeout" });
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) return;
      if (stdoutBytes >= maxStdoutBytes) {
        truncated = true;
        return;
      }
      const remaining = maxStdoutBytes - stdoutBytes;
      if (chunk.length > remaining) {
        stdoutChunks.push(chunk.subarray(0, remaining));
        stdoutBytes = maxStdoutBytes;
        truncated = true;
      } else {
        stdoutChunks.push(chunk);
        stdoutBytes += chunk.length;
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      if (code === 0) {
        resolve({ kind: "ok", stdout, truncated });
      } else {
        resolve({ kind: "error", stderr });
      }
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ kind: "error", stderr: err.message });
    });
  });
}
