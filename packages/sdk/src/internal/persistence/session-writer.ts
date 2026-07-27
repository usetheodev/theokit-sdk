/**
 * M81 — single-writer lease for a session transcript.
 *
 * ## The problem
 *
 * Nothing stops two processes appending to the same JSONL transcript. The concrete case: `exec
 * resume --last` can write into the TUI's live session. Two interleaved appends to an append-only
 * file produce lines that are each individually valid and whose SEQUENCE is fiction — and nothing
 * reports it, because every line parses.
 *
 * ## Why an exclusive lockfile rather than `withFileLock`
 *
 * The plan's ADR D2 said to compose `withFileLock`, and that was the right instinct — do not build a
 * second lock mechanism. It turned out not to fit the SHAPE: `withFileLock(path, fn)` is
 * scope-based — it holds the lock for the duration of a callback. A session lease is **held across
 * turns**, for as long as the process owns the session, with an explicit `release()`. Wrapping the
 * whole session lifetime in a callback would invert control of the entire agent loop.
 *
 * So this uses the same underlying primitive `withFileLock` uses (an exclusive-create lockfile,
 * `wx`) with lease semantics on top. That keeps the mechanism single — the file-existence lock —
 * while giving it the lifetime the caller needs. The deviation from D2 is recorded here because the
 * plan's rationale (no second mechanism) still holds; only its shape assumption did not.
 *
 * ## Fail fast, never wait
 *
 * A second writer that WAITED would block `exec` behind a TUI session that can last hours. The typed
 * error lets the caller choose: fork to a new id, or give up with a real diagnosis.
 *
 * @internal
 */

import { closeSync, openSync, rmSync } from "node:fs";

import { TheokitAgentError } from "../../errors.js";

/**
 * M81 — another process already holds the writer lease for this session.
 *
 * Carries `sessionPath` because knowing WHICH session is busy is what lets the caller decide between
 * forking and waiting for the user to close the TUI (`rules/error-handling.md § 2` — context enough
 * to act on).
 */
export class SessionBusyError extends TheokitAgentError {
  override readonly name = "SessionBusyError";

  constructor(readonly sessionPath: string) {
    super(
      `another process is already writing this session: ${sessionPath}. ` +
        "Fork it to a new id instead of appending — two writers interleave lines into a sequence " +
        "that parses but is not what either process wrote.",
      { code: "session_busy", isRetryable: false },
    );
  }
}

/** A held writer lease. `release()` is idempotent. */
export interface SessionWriterLease {
  readonly sessionPath: string;
  release(): Promise<void>;
}

/**
 * Take the exclusive writer lease for `sessionPath`, or reject with {@link SessionBusyError}.
 *
 * The lock is a sibling `.lock` file created with `wx` — the same file-existence primitive the
 * SDK's `withFileLock` builds on. Exclusivity comes from the filesystem, so it holds across
 * processes, not just across async tasks in one process.
 */
export async function acquireSessionWriter(sessionPath: string): Promise<SessionWriterLease> {
  const lockPath = `${sessionPath}.lock`;
  let fd: number;
  try {
    fd = openSync(lockPath, "wx");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new SessionBusyError(sessionPath);
    }
    throw err;
  }
  closeSync(fd);

  let released = false;
  return {
    sessionPath,
    release: async (): Promise<void> => {
      if (released) return;
      released = true;
      rmSync(lockPath, { force: true });
    },
  };
}
