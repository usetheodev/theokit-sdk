/**
 * Refuse to destroy a session another process is still writing.
 *
 * Every agent product that lets a user delete or overwrite a session needs this, and the failure is
 * unrecoverable in the worst way: a transcript removed underneath a running session takes with it
 * everything that session had not flushed, and nothing errors. The user sees a successful delete.
 *
 * ## The ordering is the point
 *
 * The check runs BEFORE anything is mutated. Removing a registry entry and then refusing leaves a
 * session that can be neither opened nor deleted — worse than either outcome on its own. So this is
 * a function the caller passes through rather than a flag it may consult afterwards: the throw is
 * what stops the mutation, and there is no way to read the answer and forget to act on it.
 *
 * ## What is generic, and what is not
 *
 * The RULE is: a session declared live is not destroyable, and refusing says which one and why. The
 * VOCABULARY is not — how a product decides liveness (a pointer file, the newest transcript, a
 * lease, an active registry entry) is its own. Nothing here touches a filesystem.
 *
 * @public
 */

import { TheokitAgentError } from "./errors.js";

/** Why the destruction was refused. @public */
export type LiveSessionReason = "session-is-live" | "liveness-undetermined";

/**
 * Raised by `guardSessionDestruction` instead of letting a session be destroyed.
 *
 * Read `reason` rather than the message when deciding what to do: `"session-is-live"` is fixed by
 * closing the other session, `"liveness-undetermined"` is fixed by making the liveness check work
 * again, and telling a user to close a session when nothing could be read sends them to close
 * nothing. `sessionId` carries the session the refusal was about.
 *
 * @public
 */
export class LiveSessionError extends TheokitAgentError {
  override readonly name = "LiveSessionError";
  readonly sessionId: string;
  readonly reason: LiveSessionReason;

  constructor(sessionId: string, reason: LiveSessionReason) {
    super(
      reason === "session-is-live"
        ? `refusing to destroy session ${sessionId}: it is live — another process is probably still ` +
            `appending to it. Switch to another session first.`
        : `refusing to destroy session ${sessionId}: the set of live sessions could not be ` +
            `determined, so this cannot be shown to be safe. Resolve that before deleting.`,
    );
    this.sessionId = sessionId;
    this.reason = reason;
  }
}

/**
 * Throw unless `sessionId` is safe to destroy.
 *
 * @param live - the sessions the product declares live, or `undefined` when it could not tell.
 *   The distinction is load-bearing: an EMPTY set is a legitimate answer (nothing is open), while
 *   `undefined` refuses. A product that swallowed a read error and returned `[]` would hand this
 *   guard the one input that disables it entirely, on exactly the path that destroys data.
 * @throws LiveSessionError naming the session and the reason — "close that session" and "the guard
 *   could not read" have different fixes, and conflating them sends the user to close nothing.
 * @public
 */
export function guardSessionDestruction(
  sessionId: string,
  live: readonly string[] | undefined,
): void {
  if (live === undefined) {
    throw new LiveSessionError(sessionId, "liveness-undetermined");
  }
  if (live.includes(sessionId)) {
    throw new LiveSessionError(sessionId, "session-is-live");
  }
}
