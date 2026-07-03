/**
 * M3 #62 — scoped session state.
 *
 * A conversation id can be namespaced by SCOPE so a consumer keeps app-durable,
 * user-durable, and ephemeral (temp) session data separated in the same store:
 *
 * - `app:`  — durable state shared across users (app-level memory).
 * - `user:` — durable state for one user.
 * - `temp:` — ephemeral state; prune it with `adapter.deleteScope("temp")` on
 *   logout / session end so it never accumulates.
 *
 * The scope is a prefix on the conversation id (`"<scope>__<id>"`), so it works
 * with any {@link ConversationStorageAdapter} — no new storage surface required.
 * The `__` separator is path-safe (unlike `:`, which the FS adapter's identifier
 * guard rejects). `deleteScope(prefix)` (optional on the adapter) removes every
 * conversation with that prefix in one call.
 *
 * @public
 */

/** M3 #62 — session state scope. */
export type SessionScope = "app" | "user" | "temp";

/** M3 #62 — build a scope-namespaced conversation id (`"<scope>__<id>"`). */
export function scopedConversationId(scope: SessionScope, id: string): string {
  return `${scope}__${id}`;
}

/** M3 #62 — the id prefix (`"<scope>__"`) used to match a scope's conversations. */
export function sessionScopePrefix(scope: SessionScope): string {
  return `${scope}__`;
}
