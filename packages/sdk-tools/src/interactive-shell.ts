/**
 * `interactive_shell` + `write_stdin` — built-in tools for driving an interactive
 * session (a REPL, `git rebase -i`, any command that PROMPTS for stdin).
 *
 * Surface-agnostic by construction: both tools depend on an INJECTED
 * `InteractiveProvider` (`@theokit/sdk/interactive`) exactly as `read_file`
 * depends on `FilesystemProvider`. The HOST supplies the backend — a local
 * `@theokit/sdk-pty` (terminal), a container/E2B backend (cluster/web), or a
 * Tauri backend (desktop) — so the SAME tool runs on every theokit surface with
 * NO native dependency here. When no backend is injected (or it cannot allocate
 * a session) the tool returns `{ ok: false, error: 'interactive_unavailable' }`
 * and the agent falls back to non-interactive exec.
 *
 * Return shapes (always a JSON string):
 *   interactive_shell → `{ ok: true, session_id, output }` | `{ ok: false, error }`
 *   write_stdin       → `{ ok: true, output, alive }`       | `{ ok: false, error }`
 */

import type { CustomTool } from "@theokit/sdk";
import { Tool } from "@theokit/sdk";
import {
  type InteractiveProvider,
  InteractiveUnavailableError,
  NoSuchSessionError,
  resolveInteractive,
} from "@theokit/sdk/interactive";
import { z } from "zod";

export interface CreateInteractiveShellToolOptions {
  /** M76 — name exposed to the model. Omitted => today's literal (additive). The name is a contract:
   *  the approval key, what the model sees and what telemetry records. */
  name?: string;
  /** M76 — description exposed to the model. Omitted => today's literal (additive). */
  description?: string;
  /** The interactive backend, or a per-request resolver of one (injected — never a direct native dep). */
  interactive: InteractiveProvider<unknown>;
}

/**
 * U-2 — a session cap carries `max` and `liveSessionIds`, and those are the only fields the model
 * can act on: without them "interactive_unavailable" cannot be told apart from a missing backend,
 * and the obvious remedy (reuse one of the open sessions) is invisible.
 *
 * Checked STRUCTURALLY rather than with `instanceof`. The class that raises it lives in
 * `@theokit/sdk-pty`, which this package does not depend on and should not — and the tool accepts an
 * INJECTED backend, so any provider reporting the same two fields deserves the same treatment.
 */
function capFields(err: object): { max: number; liveSessionIds: readonly string[] } | undefined {
  const e = err as { max?: unknown; liveSessionIds?: unknown };
  if (typeof e.max !== "number") return undefined;
  if (!Array.isArray(e.liveSessionIds)) return undefined;
  if (!e.liveSessionIds.every((id) => typeof id === "string")) return undefined;
  return { max: e.max, liveSessionIds: e.liveSessionIds as readonly string[] };
}

/** Map the SDK's typed interactive errors to the tool's `{ ok: false, error }` JSON. Re-throws anything
 *  else (a real bug), per the sdk-tools "JSON on user mistakes, throw on SDK bugs" contract. */
function toErrorJson(err: unknown): string {
  // Before the superclass branch: `MaxSessionsError extends InteractiveUnavailableError`, so
  // matching the parent first flattened the subclass and dropped what made it actionable.
  if (typeof err === "object" && err !== null) {
    const cap = capFields(err);
    if (cap !== undefined) {
      return JSON.stringify({
        ok: false,
        error: "interactive_session_limit",
        max: cap.max,
        live_session_ids: [...cap.liveSessionIds],
        message: (err as { message?: unknown }).message,
      });
    }
  }
  if (err instanceof InteractiveUnavailableError) {
    return JSON.stringify({ ok: false, error: "interactive_unavailable" });
  }
  if (err instanceof NoSuchSessionError) {
    return JSON.stringify({ ok: false, error: "no_such_session" });
  }
  throw err;
}

/** Start an interactive session; returns a `session_id` to drive with `write_stdin`. */
export function createInteractiveShellTool(opts: CreateInteractiveShellToolOptions): CustomTool {
  const { interactive } = opts;
  return Tool.create({
    name: opts.name ?? "interactive_shell",
    description:
      opts.description ??
      "Start an interactive shell session for a command that PROMPTS for input or is a REPL " +
        "(python, node, `git rebase -i`, a `read` prompt) — NOT for one-shot commands (use shell_exec). " +
        "Returns a session_id; drive it with write_stdin, reading the incremental output each step. " +
        "Returns { ok, session_id, output } or { ok: false, error }.",
    inputSchema: z.object({
      command: z
        .string()
        .min(1)
        .describe("Command to run interactively, e.g. 'python3' or 'bash -i'."),
      yield_time_ms: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("How long to wait for startup output before returning (clamped by the backend)."),
    }),
    handler: async ({ command, yield_time_ms }, ctx) => {
      try {
        const backend = await resolveInteractive(interactive, ctx ?? {});
        const { sessionId, output } = await backend.startInteractive(command, {
          yieldMs: yield_time_ms,
        });
        return JSON.stringify({ ok: true, session_id: sessionId, output });
      } catch (err) {
        return toErrorJson(err);
      }
    },
  });
}

/** Write to a live interactive session's stdin and read the output it produces. */
export function createWriteStdinTool(opts: CreateInteractiveShellToolOptions): CustomTool {
  const { interactive } = opts;
  return Tool.create({
    name: "write_stdin",
    description:
      "Write input to a live interactive session (from interactive_shell) and read the output it " +
      "produces during the wait window. Include a trailing newline to submit a line. Returns " +
      "{ ok, output, alive } (alive:false means the session exited) or { ok: false, error }.",
    inputSchema: z.object({
      session_id: z.string().min(1).describe("The session_id returned by interactive_shell."),
      input: z.string().describe("Text to write to stdin (add a trailing '\\n' to submit a line)."),
      yield_time_ms: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("How long to wait for output before returning (clamped by the backend)."),
    }),
    handler: async ({ session_id, input, yield_time_ms }, ctx) => {
      try {
        const backend = await resolveInteractive(interactive, ctx ?? {});
        const { output, alive } = await backend.writeStdin(session_id, input, {
          yieldMs: yield_time_ms,
        });
        return JSON.stringify({ ok: true, output, alive });
      } catch (err) {
        return toErrorJson(err);
      }
    },
  });
}
