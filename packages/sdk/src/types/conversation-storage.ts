/**
 * Pluggable persistence for conversation history (Production-Readiness #1, ADRs D303-D306).
 *
 * The default {@link FileSystemConversationStorage} writes append-only JSONL
 * to `<cwd>/.theokit/agents/<id>/messages.jsonl`. Custom adapters back the
 * SDK against Postgres, Redis, Durable Objects, or any other store — required
 * for serverless deploys (a peer vendor, Cloudflare Workers) and multi-host setups
 * (K8s replicas, TheoCloud) where the filesystem is ephemeral or not shared.
 *
 * @public
 */

/**
 * Persisted message envelope used by {@link ConversationStorageAdapter}.
 *
 * The shape is deliberately narrower than the full {@link SDKMessage} variant
 * tree — only durable content survives. `role` covers all message origins the
 * SDK persists today (user/assistant) plus the forward-compat slots for
 * tool-shaped messages (ADR D310 / EC-10).
 *
 * @public
 */
export interface StoredMessage {
  /**
   * Origin of the message. `tool_call` / `tool_result` are produced by
   * `buildReplayHistory` (M1-3) for stateless replay; a consumer feeding a
   * `user`/`assistant`-only wire-mapper must map those two roles itself.
   */
  role: "user" | "assistant" | "system" | "tool_call" | "tool_result";
  /** UTF-8 payload. May be empty string (e.g., a tool with no return value). */
  content: string;
  /** Optional epoch-ms timestamp. Implementations MAY default to `Date.now()` on append. */
  at?: number;
}

/**
 * Pluggable conversation persistence contract.
 *
 * Implementations MUST be safe under concurrent append from a single process
 * — the SDK runtime serializes per-(agent,cwd) but adapters serving multiple
 * processes are responsible for their own atomicity.
 *
 * All methods return `Promise<>` even for synchronous backends (in-memory).
 * Polymorphism uniformity beats the ~1μs microtask cost (ADR D306).
 *
 * @public
 */
export interface ConversationStorageAdapter {
  /**
   * Return the message history for a conversation, in insertion order.
   * MUST return `[]` (not throw) when the conversation does not exist.
   *
   * M2 #63 — an optional `{ offset, limit }` window paginates the result so a
   * caller hydrating a long history is not forced to materialize the whole log.
   * Omitting `opts` returns the full history (backward-compatible). `offset`
   * counts from the oldest message; `limit` bounds the returned count.
   */
  getMessages(
    conversationId: string,
    opts?: { offset?: number; limit?: number },
  ): Promise<readonly StoredMessage[]>;

  /**
   * Append a single message to the conversation.
   * MUST be atomic — concurrent appends MUST NOT corrupt the log.
   * MUST create the conversation lazily if it does not exist.
   */
  appendMessage(conversationId: string, message: StoredMessage): Promise<void>;

  /**
   * M2 #63 — optional batch append: write a whole conversation turn
   * (user + assistant + N tool results) in ONE atomic operation. The default FS
   * adapter uses a single locked `appendFile` (one open per turn instead of N).
   * Adapters that do not implement it fall back to looping `appendMessage`.
   * MUST be atomic as a unit — a partial batch MUST NOT be observable.
   */
  appendMessages?(conversationId: string, messages: readonly StoredMessage[]): Promise<void>;

  /**
   * Delete the entire conversation. MUST be idempotent (delete-of-missing = ok).
   */
  deleteConversation(conversationId: string): Promise<void>;

  /**
   * Optional: list conversation ids. Used by housekeeping flows.
   * Implementations that cannot enumerate (e.g., wildcards too expensive on
   * production Redis) MAY return `undefined` to signal "not supported".
   */
  listConversationIds?(opts?: { limit?: number }): Promise<readonly string[] | undefined>;

  /**
   * Optional FS-specific compaction trigger (ADR D304). The default FS adapter
   * trims old turns past a soft cap; other backends typically no-op.
   */
  compact?(conversationId: string, maxTurns: number): Promise<void>;

  /**
   * Optional: dispose underlying handles (close DB pool, etc.).
   * MUST be safe to call multiple times.
   */
  dispose?(): Promise<void>;
}
