/**
 * `run_vitest` — built-in tool for coding agents.
 *
 * Runs vitest against an optional file/pattern scope and returns the
 * parsed JSON report. Hardened against the same subprocess failure
 * modes as `git_diff`:
 *
 *   - 120s wall clock timeout (vitest can be slow on first run)
 *   - Process group kill on timeout (EC-7 — defeats vitest workers as
 *     grandchildren of the spawned shell)
 *   - **EC-12**: vitest stdout may contain deprecation warnings BEFORE
 *     the JSON payload. The parser scans line-by-line and extracts the
 *     LAST valid JSON object, not the first.
 *
 * Result shape (always a JSON string):
 *   - `{ ok: true, summary: { numTotalTests, numPassedTests, numFailedTests, success } }`
 *   - `{ ok: false, error: 'path_traversal' | 'forbidden_path' | 'timeout' |
 *        'no_vitest' | 'unparseable_output' }`
 *
 * Implementation note: invokes vitest via `npx --no-install vitest`. The
 * `--no-install` avoids the agent triggering a multi-megabyte download
 * mid-turn if vitest is missing — the tool fails cleanly with
 * `no_vitest` instead.
 */

import { spawn } from "node:child_process";
import type { CustomTool } from "@theokit/sdk";

import { Tool } from "@theokit/sdk";
import { z } from "zod";
import { isForbiddenPath } from "./internal/path-guard.js";
import { checkPathScope } from "./path-scope.js";
import { armTimeoutKill, attachChildSettlers } from "./subprocess.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_STDOUT_BYTES = 10 * 1024 * 1024;

export interface CreateRunVitestToolOptions {
  projectRoot: string;
  timeoutMs?: number;
  maxStdoutBytes?: number;
}

export interface VitestSummary {
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  success?: boolean;
}

export function createRunVitestTool(opts: CreateRunVitestToolOptions): CustomTool {
  const {
    projectRoot,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxStdoutBytes = DEFAULT_MAX_STDOUT_BYTES,
  } = opts;

  return Tool.create({
    name: "run_vitest",
    description:
      "Run the project's vitest suite, optionally scoped to a file or " +
      "pattern via 'path'. Returns parsed { ok, summary } or { ok: false, " +
      "error }. Vitest stdout warnings are stripped — the parser extracts " +
      "the trailing JSON report.",
    inputSchema: z.object({
      path: z
        .string()
        .optional()
        .describe("Optional vitest pattern or file path (project-relative)."),
    }),
    handler: async ({ path }) => {
      const scopeError = validateVitestScope(path, projectRoot);
      if (scopeError !== null) return scopeError;

      const args = ["--no-install", "vitest", "run", "--reporter=json"];
      if (path !== undefined && path !== "") args.push(path);

      const result = await runProcess(projectRoot, "npx", args, timeoutMs, maxStdoutBytes);
      return formatVitestResult(result, timeoutMs);
    },
  });
}

function validateVitestScope(path: string | undefined, projectRoot: string): string | null {
  if (path !== undefined && path !== "" && isForbiddenPath(path)) {
    return JSON.stringify({ ok: false, error: "forbidden_path", path });
  }
  return checkPathScope(path, projectRoot);
}

function formatVitestResult(result: ProcessResult, timeoutMs: number): string {
  if (result.kind === "timeout") {
    return JSON.stringify({ ok: false, error: "timeout", timeoutMs });
  }
  if (result.kind === "spawn_error") {
    return JSON.stringify({ ok: false, error: "no_vitest", detail: result.message });
  }
  const summary = extractTrailingJson(result.stdout) as VitestSummary | null;
  if (summary === null) {
    return JSON.stringify({
      ok: false,
      error: "unparseable_output",
      stderrPreview: result.stderr.slice(0, 500),
    });
  }
  return JSON.stringify({ ok: true, summary });
}

/**
 * Find the LAST line in `stdout` that parses as a JSON object. Vitest
 * prepends node deprecation warnings to its JSON reporter output — if
 * we naively `JSON.parse(stdout)` we get a SyntaxError. Workaround: walk
 * lines bottom-up and return the first one that parses.
 *
 * Exported for direct unit testing without spawning vitest.
 */
export function extractTrailingJson(stdout: string): unknown {
  const lines = stdout.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!.trim();
    if (line.length === 0) continue;
    if (line[0] !== "{" && line[0] !== "[") continue;
    try {
      return JSON.parse(line) as unknown;
    } catch {
      // not valid JSON — keep looking
    }
  }
  return null;
}

function appendCapped(chunks: Buffer[], chunk: Buffer, current: number, cap: number): number {
  if (current >= cap) return current;
  const remaining = cap - current;
  if (chunk.length > remaining) {
    chunks.push(chunk.subarray(0, remaining));
    return cap;
  }
  chunks.push(chunk);
  return current + chunk.length;
}

type ProcessResult =
  | { kind: "ok"; stdout: string; stderr: string; exitCode: number }
  | { kind: "timeout" }
  | { kind: "spawn_error"; message: string };

function runProcess(
  cwd: string,
  command: string,
  args: string[],
  timeoutMs: number,
  maxStdoutBytes: number,
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;

    const gate = armTimeoutKill<ProcessResult>(
      child,
      timeoutMs,
      () => ({ kind: "timeout" }),
      resolve,
    );

    child.stdout.on("data", (chunk: Buffer) => {
      if (gate.settled()) return;
      stdoutBytes = appendCapped(stdoutChunks, chunk, stdoutBytes, maxStdoutBytes);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    attachChildSettlers<ProcessResult>(
      child,
      gate,
      (code) => ({
        kind: "ok",
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        exitCode: code ?? 0,
      }),
      (err) => ({ kind: "spawn_error", message: err.message }),
      resolve,
    );
  });
}
