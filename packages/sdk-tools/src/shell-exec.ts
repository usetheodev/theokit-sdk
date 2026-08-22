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
import { Tool } from "@theokit/sdk";
import { resolveSandbox, type SandboxProvider } from "@theokit/sdk/sandbox";
import { z } from "zod";
import { CatastrophicCommandError, catastrophicShellReason } from "./internal/shell-guard.js";
import { armTimeoutKill, attachChildSettlers } from "./subprocess.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000; // 5 minutes hard ceiling
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024; // 5 MB

/** Run `command` through an injected SandboxBackend, mapping its result to shell_exec's JSON shape. */
async function execViaSandbox(
  sandbox: SandboxProvider,
  ctx: unknown,
  command: string,
  timeoutMs: number,
): Promise<string> {
  const backend = await resolveSandbox(sandbox, ctx ?? {});
  const r = await backend.execute(command, { timeoutMs });
  return r.timedOut
    ? JSON.stringify({ ok: false, error: "timeout", timeout_ms: timeoutMs })
    : JSON.stringify({ ok: true, stdout: r.stdout, stderr: r.stderr, exit_code: r.exitCode });
}

export interface CreateShellToolOptions {
  /**
   * M76 — the name exposed to the model. Omitted ⇒ today's literal (additive).
   *
   * It exists because, in Codex, the name is BORN in the tool definition and is the approval decision
   * key — three consumers (model, approval, telemetry) of a string decided in one place. Renaming
   * after construction changes the identity of something already published to the model. `withName`
   * remains for the genuinely dynamic case.
   */
  name?: string;
  /** M76 — description exposed to the model. Omitted => today's literal (additive). */
  description?: string;
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
  /**
   * Optional injected execution backend (`@theokit/sdk/sandbox`) — a backend or a per-request resolver.
   * When provided, the command runs via `SandboxBackend.execute` (Local/Docker/E2B) so the tool is
   * surface-agnostic (a cluster/desktop host runs it in the sandbox, not the local host); omitted ⇒ the
   * local `/bin/sh -c` child process (byte-identical to before). The catastrophic-command guard runs
   * before either path.
   */
  sandbox?: SandboxProvider;
}

/**
 * Build the `shell_exec` tool: run a command through `/bin/sh -c` with `projectRoot` as the working
 * directory.
 *
 * Reserve it for what has no dedicated tool — tests, git, package managers, build steps. Reading,
 * writing, editing and searching files each have a path-checked tool in this package, and routing
 * them through a shell gives up every one of those checks.
 *
 * The model's `timeout_ms` and `defaultTimeoutMs` (30s) are both clamped to a 5-minute ceiling that
 * is not configurable. On expiry the process group is killed and the result is
 * `{ ok: false, error: "timeout" }`. stdout and stderr are capped at 5 MB each and cut silently at
 * the cap — there is no truncation flag, so a command producing more looks like one that produced
 * exactly 5 MB.
 *
 * A non-zero exit is `{ ok: true, ..., exit_code }`, not an error: `ok` reports that the command ran,
 * `exit_code` reports whether it worked.
 *
 * The catastrophic-command screen runs before either execution path and refuses on a heuristic match
 * over the command string. It is a guardrail, not a sandbox, and `allowCatastrophic: true` removes it
 * outright. For real confinement pass `sandbox`, which routes execution through the backend — the
 * 5 MB output caps belong to the local path and do not apply there.
 */
export function createShellTool(opts: CreateShellToolOptions): CustomTool {
  const {
    projectRoot,
    defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
    allowCatastrophic = false,
    sandbox,
  } = opts;

  return Tool.create({
    name: opts.name ?? "shell_exec",
    description:
      opts.description ??
      "Execute a shell command in the project directory. Use this for terminal operations — running " +
        "tests, git, package managers, build tools. Do NOT use it for file operations (reading, " +
        "writing, editing, finding files): prefer the specialized read_file/write_file/edit_file/" +
        "glob_files/search_text tools, which are path-checked and safer. Only commit, push, or change " +
        "git state when the user explicitly asks. timeout_ms defaults to 30000 (max 300000); " +
        "stdout/stderr are capped (~5 MB). Returns { ok, stdout, stderr, exit_code } or " +
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
    handler: async ({ command, timeout_ms }, ctx) => {
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
      // Injected backend (surface-agnostic) ⇒ run in the sandbox; absent ⇒ the local child (unchanged).
      if (sandbox !== undefined) return execViaSandbox(sandbox, ctx, command, timeoutMs);
      return runShell(projectRoot, command, timeoutMs);
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

    const gate = armTimeoutKill<ShellResult>(
      child,
      timeoutMs,
      () => ({ kind: "timeout" }),
      (result) => resolve(formatResult(result, timeoutMs)),
    );

    child.stdout.on("data", (chunk: Buffer) => {
      if (gate.settled()) return;
      if (stdoutBytes >= MAX_OUTPUT_BYTES) {
        return;
      }
      const remaining = MAX_OUTPUT_BYTES - stdoutBytes;
      if (chunk.length > remaining) {
        stdoutChunks.push(chunk.subarray(0, remaining));
        stdoutBytes = MAX_OUTPUT_BYTES;
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
