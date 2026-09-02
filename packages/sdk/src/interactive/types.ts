/**
 * Interactive-session backend protocol — the streaming twin of `SandboxBackend`
 * (which is one-shot `execute`). A surface-agnostic contract for driving a
 * long-lived interactive process (a REPL, `git rebase -i`, any command that
 * PROMPTS for stdin): start → `session_id`, write to stdin, read incremental
 * output, kill.
 *
 * Injected exactly like {@link FilesystemProvider} (SE31) — the tool depends on
 * the interface, the HOST supplies the implementation, so the SAME tool runs on
 * a local PTY (`@theokit/sdk-pty`), a container/E2B backend (cluster/web), or a
 * desktop backend (Tauri) with NO tool change and NO native dependency in core.
 *
 * @public
 */

import { TheokitAgentError } from "../errors.js";

/** Thrown when the interactive path is requested but no backend can provide it
 *  (no provider injected, or a local backend whose native module / spawn failed).
 *  The caller falls back to non-interactive exec.
 *
 *  Extends {@link TheokitAgentError} like every other typed error the SDK publishes: it used to
 *  extend bare `Error`, so a consumer catching `TheokitAgentError` — the documented way to catch
 *  anything this SDK throws — missed it, and it carried no `isRetryable`. Additive: `instanceof
 *  Error` and the `code` literal are unchanged. */
export class InteractiveUnavailableError extends TheokitAgentError {
  override readonly name = "InteractiveUnavailableError";
  override readonly code = "interactive_unavailable" as const;
  constructor(message: string) {
    // Not retryable: no backend is a configuration fact, and retrying re-asks the same question.
    super(message, { code: "interactive_unavailable", isRetryable: false });
  }
}

/** Thrown (typed) when a write/kill targets an unknown or already-exited session,
 *  so callers branch on the type instead of string-matching a message.
 *
 *  Extends {@link TheokitAgentError} — see {@link InteractiveUnavailableError} for why. */
export class NoSuchSessionError extends TheokitAgentError {
  override readonly name = "NoSuchSessionError";
  override readonly code = "no_such_session" as const;
  constructor(sessionId: string) {
    // Not retryable: the session is gone, and it does not come back.
    super(`no such live session "${sessionId}" (it may have exited or been killed)`, {
      code: "no_such_session",
      isRetryable: false,
    });
  }
}

/** Result of starting a session: its id + whatever the program printed on startup. */
export interface StartInteractiveResult {
  sessionId: string;
  output: string;
}

/** Result of writing to a session: the output produced during the yield window + liveness. */
export interface WriteStdinResult {
  output: string;
  alive: boolean;
}

/** Bounds a start call. All optional; a backend clamps/defaults each. */
export interface StartInteractiveOptions {
  /** Working directory for the session. Defaults to the backend's root. */
  cwd?: string;
  /** How long to wait, in ms, before returning the startup output (clamped by the backend). */
  yieldMs?: number;
  /** Idle time, in ms, after which the backend reaps a forgotten session. */
  ttlMs?: number;
  /** Cap on the returned output bytes (tail kept). */
  maxBytes?: number;
  /** Terminal geometry, when the backend allocates a real TTY. */
  cols?: number;
  rows?: number;
}

/** Bounds a write call. */
export interface WriteStdinOptions {
  yieldMs?: number;
  ttlMs?: number;
  maxBytes?: number;
}

/**
 * Pluggable interactive-session backend. Implement the three abstract methods.
 * A backend that cannot provide interactive sessions should not be constructed —
 * callers detect absence by catching {@link InteractiveUnavailableError}.
 *
 * @public
 */
export abstract class InteractiveBackend {
  /** Spawn `command` as an interactive session; resolve after the yield window with the
   *  `session_id` + startup output. Throws {@link InteractiveUnavailableError} when the
   *  session cannot be allocated. */
  abstract startInteractive(
    command: string,
    opts?: StartInteractiveOptions,
  ): Promise<StartInteractiveResult>;

  /** Write `chars` to a live session's stdin; resolve after the yield window with the output it
   *  produced + whether it is still alive. Throws {@link NoSuchSessionError} on an unknown session. */
  abstract writeStdin(
    sessionId: string,
    chars: string,
    opts?: WriteStdinOptions,
  ): Promise<WriteStdinResult>;

  /** Kill a session (idempotent) and free its slot. */
  abstract kill(sessionId: string): void;
}

/**
 * A backend OR a per-request resolver of one — mirrors {@link FilesystemProvider}. A resolver runs
 * at tool-execution time (request scope), so multi-tenant / multi-role agents get a distinct backend
 * per request without a shared mutable one.
 *
 * @public
 */
export type InteractiveProvider<Ctx = unknown> =
  | InteractiveBackend
  | ((ctx: Ctx) => InteractiveBackend | Promise<InteractiveBackend>);

/** Resolve an {@link InteractiveProvider} to a concrete backend for `ctx`. */
export async function resolveInteractive<Ctx>(
  provider: InteractiveProvider<Ctx>,
  ctx: Ctx,
): Promise<InteractiveBackend> {
  return provider instanceof InteractiveBackend ? provider : provider(ctx);
}
