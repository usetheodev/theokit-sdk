# SE4 — Session management surface — Plan

**Milestone:** SE4 (SDK Evolution, post-Harness).

## Goal

Expose `listSessions` / `getSessionMessages` / `renameSession` / `tagSession` over the
`ConversationStorageAdapter` interface — so hosts (TheoKit) build session UIs without reaching into
storage internals. Light metadata (summary, lastModified, firstPrompt) is DERIVED from the stored
transcript; title/tag are written metadata; adapters that can't list or write metadata degrade with a
typed "unsupported" result (not a throw-on-every-call).

## Design (grounded in the codebase)

The host already OWNS the adapter (it constructs it and passes it to `Agent.create({ conversationStorage })`).
So the surface is `createSessionManager(storage)` over that same instance — the LEGO precedent of
`createSquad` / `createAgentFactory`. No `Agent.storage` getter needed.

### New types

- `src/types/session.ts` (NEW): `SessionSummary { id, messageCount, firstPrompt?, lastModified?, title?, tag?, summary? }`,
  `SessionListOptions { limit?, offset? }`, and the typed-degradation result
  `SessionCapabilityResult<T> = { supported: true; value: T } | { supported: false; reason: string }`
  (mirrors the existing `listConversationIds → undefined` / `run.unsupportedReason()` degradation precedent).
- `src/types/conversation-storage.ts`: `SessionMeta { title?, tag? }`, `SessionMetaPatch { title?, tag?: string | null }`,
  and two OPTIONAL adapter methods `getSessionMeta?` / `setSessionMeta?` (same optionality pattern as
  `listConversationIds?` / `truncateConversation?`).

### New surface

- `src/session-manager.ts` (NEW): `createSessionManager(storage): SessionManager` with:
  - `listSessions(opts?)` → unsupported when the adapter lacks `listConversationIds` (or it returns
    `undefined`); else derives `firstPrompt` (first `user` message), `lastModified` (max `at`),
    `messageCount` from `getMessages`, merges `title`/`tag` from `getSessionMeta`, and computes
    `summary = title ?? firstPrompt` (truncated). Applies `offset`/`limit` windowing.
  - `getSessionMessages(id, opts?)` → passthrough to `storage.getMessages` (always supported —
    `getMessages` is mandatory).
  - `renameSession(id, title)` / `tagSession(id, tag|null)` → unsupported when the adapter lacks
    `setSessionMeta`; else write via `setSessionMeta` (tag `null` clears).

### Adapter implementations

- `FileSystemConversationStorage`: `getSessionMeta`/`setSessionMeta` via a per-conversation sidecar
  `<root>/.theokit/agents/<safeId>/session.json` (reuses `sanitizeIdentifier` + `safePathJoin`;
  ENOENT → undefined). `listConversationIds` already exists.
- `InMemoryConversationStorage`: a second `Map<id, SessionMeta>`.

### Exports

`createSessionManager`, `SessionManager`, `SessionSummary`, `SessionListOptions`,
`SessionCapabilityResult`, `SessionMeta`, `SessionMetaPatch` from `src/index.ts`.

## Coverage Matrix

| DoD claim | Task | Test |
|---|---|---|
| list/get/rename/tag over ConversationStorage (FS+memory+external) | T2 (manager) + T3 (FS meta) + T4 (memory meta) | round-trip on FS + memory |
| Light metadata derived (summary, lastModified, firstPrompt) | T2 | listSessions asserts derived fields |
| Graceful degradation (typed unsupported) | T1 (types) + T2 | minimal adapter → {supported:false} |
| TDD list/rename/tag round-trip on FS | T3 | FS round-trip test |
| Docs + Changeset | T5 | — |

## Drawbacks & Risks

1. **Adapter incompatibility (some backends can't list/write-meta).** Mitigation: capability-probe
   (`typeof storage.X === "function"` + `undefined` return) → typed `{ supported: false }`; never assume.
2. **Leaking storage internals.** Mitigation: return light `SessionSummary` DTOs, not raw store rows;
   `getSessionMessages` returns the existing public `StoredMessage[]`.
3. **listSessions is O(N·M)** (reads each transcript to derive metadata). Mitigation: `offset`/`limit`
   windowing bounds the number of transcripts read; documented as a light-metadata scan, not an index.

## Unresolved Questions

(none) — scope prefixes (`app:`/`user:`/`temp:`) are exposed verbatim on `SessionSummary.id`; a host
strips them via `sessionScopePrefix` if desired (out of scope for SE4).
