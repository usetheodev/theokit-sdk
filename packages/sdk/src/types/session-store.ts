/**
 * SE41 — the pluggable `SessionStore` seam over the NATIVE session transcript.
 *
 * A minimal, two-method port so an external store (Postgres / Redis / KV /
 * durable object) can be the **primary store AND resume source** — the
 * serverless (ephemeral FS) and multi-host / multi-pod use case that SE40
 * dropped when it removed the `ConversationStorageAdapter`. This is deliberately
 * NOT that removed ~10-method adapter: the seam is JUST record read/append over
 * the native {@link SessionRecord} shape (no getMessages / getSessionMeta /
 * delete / objective methods).
 *
 * The SDK ships a real default implementation, `FsSessionStore`, that reads and
 * append-writes the native Claude-shaped `.jsonl` transcript — omitting
 * `local.sessionStore` yields byte-identical current behavior (back-compat, zero
 * consumer change). Injected via `local.sessionStore` for external stores.
 *
 * Consistency contract: `appendRecords` is append-only and ordering-preserving.
 * The FS default serializes appends per agent with a cross-process file lock;
 * external implementations own (and MUST document) their own concurrency
 * guarantees for two hosts appending to the same `agentId`.
 *
 * @public
 */

// `SessionRecord` is the native on-disk record shape. It lives in the internal
// persistence module (the DAG core); the public seam re-exports it so consumers
// implementing a `SessionStore` type against the same records the SDK writes.
// Type-only import — erased at compile, so no runtime import cycle.
import type { SessionRecord } from "../internal/persistence/session-transcript.js";

export type { SessionRecord } from "../internal/persistence/session-transcript.js";

/**
 * The pluggable session-store seam. Exactly two methods over the native
 * {@link SessionRecord} shape.
 *
 * @public
 */
export interface SessionStore {
  /**
   * Return every persisted record for `agentId`, in append order. A session
   * that was never written MUST resolve to `[]` (not throw) — a fresh agent has
   * no history. The SDK reconstructs the resumable `LlmMessage[]` from these
   * records via the native DAG reader, so the shape MUST be the exact
   * {@link SessionRecord} the SDK writes.
   *
   * A store that cannot READ (e.g. the backing DB is unreachable on resume)
   * MUST throw a typed error rather than silently returning `[]` — a silent
   * empty read would masquerade as "no history" and drop the conversation.
   */
  readRecords(agentId: string): Promise<SessionRecord[]>;

  /**
   * Append `records` (the new-turn delta) to `agentId`'s session, append-only.
   * MUST preserve order and MUST NOT drop or rewrite prior records — the native
   * format is an append-only `parentUuid` DAG (compaction is a new-root
   * `compact_boundary` record, still an append).
   *
   * Note on the write path: per-turn persistence is fire-and-forget so `send()`
   * is never blocked by store I/O — an `appendRecords` rejection is logged to
   * stderr, NOT thrown to the caller (best-effort write). An external store that
   * must guarantee durability should make `appendRecords` resilient (retry /
   * durable write) internally. This differs from {@link SessionStore.readRecords},
   * which MUST throw on failure (a resume cannot proceed on a silent partial history).
   */
  appendRecords(agentId: string, records: readonly SessionRecord[]): Promise<void>;
}
