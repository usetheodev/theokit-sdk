/**
 * In-memory implementation of {@link ConversationStorageAdapter} (Production-Readiness #1, ADR D304).
 *
 * Intended for tests + ephemeral single-process dev/CLI usage. Holds messages
 * in a `Map<conversationId, StoredMessage[]>`. JavaScript's single-threaded
 * runtime makes per-conversation appends naturally atomic; no external mutex
 * needed.
 *
 * The adapter returns defensive copies from `getMessages` so callers cannot
 * mutate internal state by holding a reference to the returned array.
 *
 * @public
 */

import type {
  ConversationStorageAdapter,
  SessionMeta,
  SessionMetaPatch,
  StoredMessage,
} from "../../types/conversation-storage.js";
import type { ObjectiveRecord } from "../../types/objective.js";
import { paginate } from "./pagination.js";
import { applyMetaPatch } from "./session-meta.js";

export class InMemoryConversationStorage implements ConversationStorageAdapter {
  readonly #store = new Map<string, StoredMessage[]>();
  // SE4 — session-level metadata (title/tag), kept beside the transcript.
  readonly #meta = new Map<string, SessionMeta>();
  // SE33 — durable thread-scoped objective, kept beside the transcript.
  readonly #objectives = new Map<string, ObjectiveRecord>();

  async getMessages(
    conversationId: string,
    opts?: { offset?: number; limit?: number },
  ): Promise<readonly StoredMessage[]> {
    const existing = this.#store.get(conversationId);
    // Defensive copy — caller mutation MUST NOT affect storage state.
    // M2 #63 — apply the optional pagination window (true bounded read in memory).
    return existing === undefined ? [] : paginate(existing.slice(), opts);
  }

  async appendMessage(conversationId: string, message: StoredMessage): Promise<void> {
    this.#appendOne(conversationId, message);
  }

  async appendMessages(conversationId: string, messages: readonly StoredMessage[]): Promise<void> {
    // M2 #63 — single-threaded runtime makes the loop atomic as a unit.
    for (const message of messages) this.#appendOne(conversationId, message);
  }

  #appendOne(conversationId: string, message: StoredMessage): void {
    const existing = this.#store.get(conversationId);
    const stamped: StoredMessage =
      message.at === undefined ? { ...message, at: Date.now() } : message;
    if (existing === undefined) {
      this.#store.set(conversationId, [stamped]);
      return;
    }
    existing.push(stamped);
  }

  async truncateConversation(conversationId: string, keepCount: number): Promise<number> {
    // M3 #67 — transcript revert (single-threaded runtime → atomic).
    const existing = this.#store.get(conversationId);
    if (existing === undefined) return 0;
    const keep = Math.max(0, Math.min(keepCount, existing.length));
    this.#store.set(conversationId, existing.slice(0, keep));
    return keep;
  }

  async deleteConversation(conversationId: string): Promise<void> {
    // Idempotent — delete-of-missing is OK (Map.delete returns false silently).
    this.#store.delete(conversationId);
    // SE4 — drop session metadata too, else a recreated id inherits ghost title/tag.
    this.#meta.delete(conversationId);
    // SE33 — drop the durable objective with the transcript.
    this.#objectives.delete(conversationId);
  }

  async deleteScope(prefix: string): Promise<number> {
    // M3 #62 — prune a whole session scope (e.g. "temp:") in one call.
    // MEDIUM-1 fix — count over the UNION of ids across all three sidecar maps so
    // a scope member is counted once whether it has a transcript, only metadata,
    // or only a durable objective (previously objective-/meta-only ids were dropped
    // but not counted). One sweep, one count per unique id.
    let n = 0;
    const ids = new Set<string>([
      ...this.#store.keys(),
      ...this.#meta.keys(),
      ...this.#objectives.keys(),
    ]);
    for (const id of ids) {
      if (!id.startsWith(prefix)) continue;
      this.#store.delete(id);
      this.#meta.delete(id); // SE4 — prune the sidecar metadata with the transcript.
      this.#objectives.delete(id); // SE33 — prune the durable objective too.
      n += 1;
    }
    return n;
  }

  async listConversationIds(opts?: { limit?: number }): Promise<readonly string[]> {
    const all = Array.from(this.#store.keys());
    if (opts?.limit !== undefined) return all.slice(0, opts.limit);
    return all;
  }

  async getSessionMeta(conversationId: string): Promise<SessionMeta | undefined> {
    const meta = this.#meta.get(conversationId);
    return meta === undefined ? undefined : { ...meta };
  }

  async setSessionMeta(conversationId: string, patch: SessionMetaPatch): Promise<void> {
    const current = this.#meta.get(conversationId) ?? {};
    this.#meta.set(conversationId, applyMetaPatch(current, patch));
  }

  async getObjectiveRecord(conversationId: string): Promise<ObjectiveRecord | undefined> {
    const rec = this.#objectives.get(conversationId);
    return rec === undefined ? undefined : { ...rec };
  }

  async setObjectiveRecord(conversationId: string, record: ObjectiveRecord | null): Promise<void> {
    if (record === null) this.#objectives.delete(conversationId);
    else this.#objectives.set(conversationId, { ...record });
  }

  // SE33 (HIGH-1 fix) — atomic in the single-threaded runtime: the get→mutate→set
  // runs synchronously, so there is no interleaving window for a concurrent frame.
  async updateObjectiveRecord(
    conversationId: string,
    mutate: (current: ObjectiveRecord | undefined) => ObjectiveRecord | null | undefined,
  ): Promise<void> {
    const current = this.#objectives.get(conversationId);
    const next = mutate(current === undefined ? undefined : { ...current });
    if (next === undefined) return; // unchanged
    if (next === null) this.#objectives.delete(conversationId);
    else this.#objectives.set(conversationId, { ...next });
  }

  async dispose(): Promise<void> {
    // No external handles. Clear for symmetry with FS-backed adapters.
    this.#store.clear();
    this.#meta.clear();
    this.#objectives.clear();
  }
}
