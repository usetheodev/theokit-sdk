/**
 * Owner: `internal/session/` (4 of 8 importers). Derived from the import graph, not declared —
 * `tests/lint/types-name-their-owner.test.ts` re-derives it.
 *
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

// `SessionRecord` is the native on-disk record shape. It lives in the domain
// `types/` layer (SE46 DIP direction); the public seam re-exports it so
// consumers implement a `SessionStore` type against the same records the SDK
// writes. Type-only import — erased at compile, so no runtime import cycle.
import type { SessionRecord } from "./session-record.js";

export type { SessionRecord } from "./session-record.js";

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

  /**
   * Claim the single-writer lease for `agentId`, if this store has one. OPTIONAL.
   *
   * The SDK calls it when an agent starts and skips it when absent, so a two-method store keeps
   * working unchanged — declaring it here does not require it, which is the whole reason it is
   * optional. What declaring it DOES is make the capability discoverable: the SDK probed for this
   * method through an `as unknown` cast against an interface that never mentioned it, so a
   * third-party store author — the serverless / multi-pod case this port exists to serve — read a
   * two-method interface, implemented two methods, and never learned the hook was there.
   *
   * CONTRACT, and the half that matters: a rejection whose `name` is `"SessionBusyError"` PROPAGATES
   * to the caller, because another process holding the session is a decision the caller has to make
   * (`exec` forks to a new id). Any other rejection is treated as "no lease available here" —
   * logged, and the turn proceeds without single-writer protection, since the write is best-effort
   * by contract anyway.
   */
  acquire?(agentId: string): Promise<void>;

  /**
   * Release the lease `acquire` claimed, if this store has one. OPTIONAL.
   *
   * Called on agent disposal. A rejection is not handled specially.
   */
  release?(agentId: string): Promise<void>;

  /**
   * Release store-level resources — a connection pool, a file handle. OPTIONAL.
   *
   * Called once, on agent disposal, after {@link SessionStore.release}.
   */
  dispose?(): Promise<void>;
}
