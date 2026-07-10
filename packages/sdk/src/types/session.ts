/**
 * SE4 — public types for the session-management surface (`createSessionManager`).
 *
 * A "session" is one conversation in a {@link ConversationStorageAdapter}. These
 * DTOs are deliberately LIGHT — derived display metadata, not raw store rows — so
 * a host (TheoKit) can build a session list/UI without reaching into storage
 * internals.
 *
 * @public
 */

import type { StoredMessage } from "./conversation-storage.js";

/**
 * Light, display-oriented metadata for one session, derived from its transcript
 * plus any host-set title/tag. All fields except `id`/`messageCount` are optional
 * because a fresh or empty session may lack them.
 *
 * @public
 */
export interface SessionSummary {
  /** The conversation id (verbatim — includes any scope prefix like `user__`). */
  readonly id: string;
  /** Number of stored messages in the transcript. */
  readonly messageCount: number;
  /** Content of the first `user` message, when present — the opening prompt. */
  readonly firstPrompt?: string;
  /** Largest message timestamp (`StoredMessage.at`) seen, when any is stamped. */
  readonly lastModified?: number;
  /** Host-set title (via `renameSession`), when set. */
  readonly title?: string;
  /** Host-set tag (via `tagSession`), when set. */
  readonly tag?: string;
  /**
   * A short display preview: the `title` when set, otherwise the `firstPrompt`
   * (truncated). Undefined only when the session has neither a title nor a first
   * user prompt.
   */
  readonly summary?: string;
}

/**
 * Windowing for {@link SessionManager.listSessions}. `offset` counts from the
 * first listed session; `limit` bounds the returned count. Omitting both lists
 * all sessions (bounded only by the adapter's own `listConversationIds` limit).
 *
 * @public
 */
export interface SessionListOptions {
  readonly offset?: number;
  readonly limit?: number;
}

/**
 * Typed capability result — the graceful-degradation signal for operations an
 * adapter cannot perform (listing, or writing session metadata). Prefer this over
 * throwing on every call: a host inspects `supported` once and hides the
 * corresponding UI affordance. Mirrors the SDK's existing degradation precedent
 * (`ConversationStorageAdapter.listConversationIds` returning `undefined`,
 * `Run.unsupportedReason`).
 *
 * @public
 */
export type SessionCapabilityResult<T> =
  | { readonly supported: true; readonly value: T }
  | { readonly supported: false; readonly reason: string };

/**
 * The session-management surface returned by `createSessionManager`. Bound to a
 * single {@link ConversationStorageAdapter} instance (the same one a host passed
 * to `Agent.create({ conversationStorage })`).
 *
 * @public
 */
export interface SessionManager {
  /**
   * List sessions with light derived metadata. Returns an unsupported result
   * when the adapter cannot enumerate conversations (`listConversationIds`
   * absent or returning `undefined`).
   */
  listSessions(
    opts?: SessionListOptions,
  ): Promise<SessionCapabilityResult<readonly SessionSummary[]>>;
  /**
   * Read a session's stored transcript (passthrough to the adapter's mandatory
   * `getMessages`). Always supported. `{ offset, limit }` windows the result.
   */
  getSessionMessages(
    id: string,
    opts?: { offset?: number; limit?: number },
  ): Promise<readonly StoredMessage[]>;
  /**
   * Set a session's title. Unsupported when the adapter cannot write session
   * metadata (`setSessionMeta` absent).
   */
  renameSession(id: string, title: string): Promise<SessionCapabilityResult<void>>;
  /**
   * Set (`tag`) or clear (`null`) a session's tag. Unsupported when the adapter
   * cannot write session metadata (`setSessionMeta` absent).
   */
  tagSession(id: string, tag: string | null): Promise<SessionCapabilityResult<void>>;
}
