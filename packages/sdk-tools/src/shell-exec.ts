/**
 * `shell_exec` — built-in tool for coding agents.
 *
 * Executes a shell command via `/bin/sh -c` with a configurable timeout
 * and output size cap.
 *
 * Return shape (always a JSON string):
 *   - `{ ok: true, stdout, stderr, exit_code }`
 *   - `{ ok: false, error: 'timeout' | 'exec_failed' }`
 */

import { spawn } from "node:child_process";
import type { CustomTool } from "@theokit/sdk";

import { defineTool } from "@theokit/sdk";
import { z } from "zod";
import { CatastrophicCommandError, catastrophicShellReason } from "./internal/shell-guard.js";
import { armTimeoutKill, attachChildSettlers } from "./subprocess.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000; // 5 minutes hard ceiling
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024; // 5 MB

export interface CreateShellToolOptions {
  /** Absolute path to the project root. Commands execute in this cwd. */
  projectRoot: string;
  /** Default timeout in ms. Capped at 300s. */
  defaultTimeoutMs?: number;
  /**
   * Opt out of the catastrophic-command guardrail. Default `false` (the
   * guardrail screens every command before spawn). Set `true` only when the
   * agent legitimately needs destructive power flows — it is a heuristic
   * guardrail, not a sandbox.
   */
  allowCatastrophic?: boolean;
}

export function createShellTool(opts: CreateShellToolOptions): CustomTool {
  const { projectRoot, defaultTimeoutMs = DEFAULT_TIMEOUT_MS, allowCatastrophic = false } = opts;

  return defineTool({
    name: "shell_exec",
    description:
      "Execute a shell command in the project directory. Returns stdout, " +
      "stderr, and exit code. Default timeout 30s, max 5 minutes. Output " +
      "capped at 5 MB. Returns { ok, stdout, stderr, exit_code } or " +
      "{ ok: false, error }.",
    inputSchema: z.object({
      command: z.string().min(1).describe("Shell command to execute."),
      timeout_ms: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Timeout in milliseconds (default 30000, max 300000)."),
    }),
    handler: async ({ command, timeout_ms }) => {
      if (!allowCatastrophic) {
        const reason = catastrophicShellReason(command);
        if (reason) {
          // Construct the typed error so its `code` is the single source of the
          // error string (mirrors web_fetch's SsrfBlockedError handling).
          const err = new CatastrophicCommandError(reason);
          return JSON.stringify({ ok: false, error: err.code, reason });
        }
      }
      const timeoutMs = Math.min(timeout_ms ?? defaultTimeoutMs, MAX_TIMEOUT_MS);
      const result = await runShell(projectRoot, command, timeoutMs);
      return result;
    },
  });
}

type ShellResult =
  | { kind: "ok"; stdout: string; stderr: string; exitCode: number | null }
  | { kind: "timeout" }
  | { kind: "error"; message: string };

function runShell(cwd: string, command: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-c", command], {
      cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let _truncated = false;

    const gate = armTimeoutKill<ShellResult>(
      child,
      timeoutMs,
      () => ({ kind: "timeout" }),
      (result) => resolve(formatResult(result, timeoutMs)),
    );

    child.stdout.on("data", (chunk: Buffer) => {
      if (gate.settled()) return;
      if (stdoutBytes >= MAX_OUTPUT_BYTES) {
        _truncated = true;
        return;
      }
      const remaining = MAX_OUTPUT_BYTES - stdoutBytes;
      if (chunk.length > remaining) {
        stdoutChunks.push(chunk.subarray(0, remaining));
        stdoutBytes = MAX_OUTPUT_BYTES;
        _truncated = true;
      } else {
        stdoutChunks.push(chunk);
        stdoutBytes += chunk.length;
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (gate.settled()) return;
      if (stderrBytes >= MAX_OUTPUT_BYTES) return;
      const remaining = MAX_OUTPUT_BYTES - stderrBytes;
      if (chunk.length > remaining) {
        stderrChunks.push(chunk.subarray(0, remaining));
        stderrBytes = MAX_OUTPUT_BYTES;
      } else {
        stderrChunks.push(chunk);
        stderrBytes += chunk.length;
      }
    });

    attachChildSettlers<ShellResult>(
      child,
      gate,
      (code) => ({
        kind: "ok",
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        exitCode: code,
      }),
      (err) => ({ kind: "error", message: err.message }),
      (result) => resolve(formatResult(result, timeoutMs)),
    );
  });
}

function formatResult(result: ShellResult, timeoutMs: number): string {
  if (result.kind === "timeout") {
    return JSON.stringify({ ok: false, error: "timeout", timeout_ms: timeoutMs });
  }
  if (result.kind === "error") {
    return JSON.stringify({ ok: false, error: "exec_failed", message: result.message });
  }
  return JSON.stringify({
    ok: true,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exitCode,
  });
}
