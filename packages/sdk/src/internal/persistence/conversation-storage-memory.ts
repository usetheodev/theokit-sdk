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
  StoredMessage,
} from "../../types/conversation-storage.js";

export class InMemoryConversationStorage implements ConversationStorageAdapter {
  readonly #store = new Map<string, StoredMessage[]>();

  async getMessages(conversationId: string): Promise<readonly StoredMessage[]> {
    const existing = this.#store.get(conversationId);
    // Defensive copy — caller mutation MUST NOT affect storage state.
    return existing === undefined ? [] : existing.slice();
  }

  async appendMessage(conversationId: string, message: StoredMessage): Promise<void> {
    const existing = this.#store.get(conversationId);
    const stamped: StoredMessage =
      message.at === undefined ? { ...message, at: Date.now() } : message;
    if (existing === undefined) {
      this.#store.set(conversationId, [stamped]);
      return;
    }
    existing.push(stamped);
  }

  async deleteConversation(conversationId: string): Promise<void> {
    // Idempotent — delete-of-missing is OK (Map.delete returns false silently).
    this.#store.delete(conversationId);
  }

  async listConversationIds(opts?: { limit?: number }): Promise<readonly string[]> {
    const all = Array.from(this.#store.keys());
    if (opts?.limit !== undefined) return all.slice(0, opts.limit);
    return all;
  }

  async dispose(): Promise<void> {
    // No external handles. Clear for symmetry with FS-backed adapters.
    this.#store.clear();
  }
}
