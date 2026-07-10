---
"@theokit/sdk": minor
---

**SE4 — session-management surface (`createSessionManager`).**

A session-management API over the `ConversationStorageAdapter` interface, so hosts (TheoKit) can build session UIs without reaching into storage internals. Light metadata is derived from the transcript; title/tag are persisted; adapters that can't list or write metadata degrade with a typed `{ supported: false }` result instead of throwing on every call.

- `createSessionManager(storage)` → `{ listSessions, getSessionMessages, renameSession, tagSession }`, bound to the same adapter a host passed to `Agent.create({ conversationStorage })` (composition-LEGO precedent of `createSquad`).
- `listSessions(opts?)` returns `SessionSummary`s with LIGHT metadata derived from the transcript — `firstPrompt` (first user message), `lastModified` (max `StoredMessage.at`), `messageCount`, plus a `summary` preview (title when set, else the truncated first prompt). `{ offset, limit }` windows the result.
- `renameSession(id, title)` / `tagSession(id, tag | null)` persist session metadata (`tag: null` clears). `getSessionMessages(id, opts?)` passes through to the adapter's mandatory `getMessages`.
- **Typed graceful degradation:** `listSessions` is unsupported when the adapter lacks `listConversationIds` (or it returns `undefined`); `renameSession` / `tagSession` are unsupported when the adapter lacks `setSessionMeta`. `SessionCapabilityResult<T> = { supported: true; value } | { supported: false; reason }`.
- **Storage:** two new OPTIONAL adapter methods `getSessionMeta?` / `setSessionMeta?` (`SessionMeta { title?, tag? }`, `SessionMetaPatch { title?, tag?: string | null }`). `FileSystemConversationStorage` persists them in a per-conversation sidecar `.theokit/agents/<id>/session.json` (same sanitized path perimeter as the transcript); `InMemoryConversationStorage` in a `Map`.

New exports: `createSessionManager`, `SessionManager`, `SessionSummary`, `SessionListOptions`, `SessionCapabilityResult`, `SessionMeta`, `SessionMetaPatch`. Additive + backward-compatible.

Grounded in the SDK Evolution roadmap SE4 (Anthropic Agent SDK comparison).
