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
 * Implementation note: invokes vitest via `npx --no-install vitest`. The `--no-install` avoids the
 * agent triggering a multi-megabyte download mid-turn when vitest is missing. That case surfaces as
 * `no_vitest` (#347), recognised from npm's own complaint on stderr — `npx` itself starts, so the
 * spawn succeeds and only the text distinguishes a missing package from a run that produced no
 * parseable JSON. A spawn failure (`npx` not on PATH) is `no_vitest` too. If npm ever rewords its
 * message the case falls back to `unparseable_output`, with the real reason in the payload.
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
  /** M76 — name exposed to the model. Omitted => today's literal (additive). The name is a contract:
   *  the approval key, what the model sees and what telemetry records. */
  name?: string;
  /** M76 — description exposed to the model. Omitted => today's literal (additive). */
  description?: string;
  projectRoot: string;
  timeoutMs?: number;
  maxStdoutBytes?: number;
}

/**
 * The fields lifted from vitest's JSON report. All optional, because the object is the report's own
 * top level passed through unvalidated — a vitest version that renames a field yields `undefined`
 * here rather than an error, so treat a missing `success` as unknown, never as failed.
 *
 * That risk is the reason the peer range is unbounded (`vitest >=2.0.0`), and it was measured on
 * 2026-08-31 rather than left as a worry: the same two-test suite run under 2.1.9, 3.2.7 and 4.1.11
 * emitted all four fields, correctly, every time. Two majors above the declared floor are already
 * published and the promise holds.
 *
 * What that does NOT establish: this is the JSON REPORTER's contract, not a typed API — nothing
 * imports vitest here, the tool shells out to `npx --no-install vitest run --reporter=json`. So no
 * compiler will notice when a future major renames a field; the measurement above is a dated
 * observation, not a guarantee, and it expires the day vitest 5 ships. Re-run it before widening
 * anything that depends on these names.
 */
export interface VitestSummary {
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  success?: boolean;
}

/**
 * Build the `run_vitest` tool: run the project's suite and return the counts rather than the log.
 *
 * A FAILING suite is `{ ok: true, summary }` with `success: false`. `ok` reports only that vitest
 * ran; an agent that branches on `ok` reads a red suite as a green one. And the summary carries
 * counts alone — which test failed, and why, is not in the result, so chasing a failure means falling
 * back to `shell_exec`.
 *
 * Runs `npx --no-install vitest run --reporter=json`, so a project without vitest installed fails
 * instead of downloading it mid-turn. That failure arrives as `no_vitest` (#347), as does `npx` not
 * being on PATH. The remaining refusals are `path_traversal`, `forbidden_path` and `timeout`
 * (default 120s, process group killed).
 */
export function createRunVitestTool(opts: CreateRunVitestToolOptions): CustomTool {
  const {
    projectRoot,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxStdoutBytes = DEFAULT_MAX_STDOUT_BYTES,
  } = opts;

  return Tool.create({
    name: opts.name ?? "run_vitest",
    description:
      opts.description ??
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

/**
 * How npm and the shell say "the thing you asked me to run is not installed".
 *
 * `npx --no-install` starts, complains on stderr and exits non-zero with nothing on stdout, so
 * without this the case reached `unparseable_output` — which reads as "vitest ran and printed
 * something I could not parse" and sends a reader after a reporter or parser problem instead of a
 * missing dependency (#347).
 *
 * Text matching, and honestly so: npm's wording is not a contract and a future version could phrase
 * it differently. The failure mode of a miss is the OLD behaviour (`unparseable_output` with the
 * real reason in `stderrPreview`), not a wrong answer, which is why the heuristic is worth having.
 * The same idiom carries `git_diff`'s `not a git repository` detection.
 */
const VITEST_MISSING = [
  /npx canceled due to missing packages/i,
  /could not determine executable to run/i,
  /vitest: (?:command )?not found/i,
  /command not found: vitest/i,
];

/**
 * Map a finished `npx vitest` process to the tool's JSON result.
 *
 * Exported for direct testing: the interesting branches are failures that would otherwise need a
 * network-dependent `npx` run to reproduce, and a test that installs a package to assert an error
 * is a flaky test.
 */
export function formatVitestResult(result: ProcessResult, timeoutMs: number): string {
  if (result.kind === "timeout") {
    return JSON.stringify({ ok: false, error: "timeout", timeoutMs });
  }
  if (result.kind === "spawn_error") {
    return JSON.stringify({ ok: false, error: "no_vitest", detail: result.message });
  }
  const summary = extractTrailingJson(result.stdout) as VitestSummary | null;
  if (summary === null) {
    if (VITEST_MISSING.some((pattern) => pattern.test(result.stderr))) {
      return JSON.stringify({ ok: false, error: "no_vitest", detail: result.stderr.slice(0, 500) });
    }
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
