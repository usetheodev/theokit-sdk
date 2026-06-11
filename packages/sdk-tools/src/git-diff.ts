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
import type { CustomTool } from "@theokit/sdk";

import { defineTool } from "@theokit/sdk";
import { z } from "zod";
import { checkPathScope } from "./path-scope.js";
import { armTimeoutKill, attachChildSettlers } from "./subprocess.js";

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

      const scopeCheck = checkPathScope(path, projectRoot);
      if (scopeCheck !== null) return scopeCheck;

      const args = buildDiffArgs(cached, path);
      const result = await runGitProcess(projectRoot, args, timeoutMs, maxStdoutBytes);
      return formatGitResult(result, timeoutMs);
    },
  });
}

function buildDiffArgs(cached: boolean | undefined, path: string | undefined): string[] {
  const args = ["diff", "--no-color"];
  if (cached === true) args.push("--cached");
  if (path !== undefined && path !== "") args.push("--", path);
  return args;
}

function formatGitResult(result: GitProcessResult, timeoutMs: number): string {
  if (result.kind === "timeout") {
    return JSON.stringify({ ok: false, error: "timeout", timeoutMs });
  }
  if (result.kind === "error") {
    return JSON.stringify({ ok: false, error: "git_failed", stderr: result.stderr });
  }
  return JSON.stringify({ ok: true, diff: result.stdout, truncated: result.truncated });
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

    const gate = armTimeoutKill<GitProcessResult>(
      child,
      timeoutMs,
      () => ({ kind: "timeout" }),
      resolve,
    );

    child.stdout.on("data", (chunk: Buffer) => {
      if (gate.settled()) return;
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

    attachChildSettlers<GitProcessResult>(
      child,
      gate,
      (code) => {
        const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
        const stderr = Buffer.concat(stderrChunks).toString("utf-8");
        return code === 0 ? { kind: "ok", stdout, truncated } : { kind: "error", stderr };
      },
      (err) => ({ kind: "error", stderr: err.message }),
      resolve,
    );
  });
}
