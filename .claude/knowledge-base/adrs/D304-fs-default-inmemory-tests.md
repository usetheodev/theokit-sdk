# D304 — `FileSystemConversationStorage` is zero-config default; `InMemoryConversationStorage` for tests

**Status:** Accepted
**Date:** 2026-05-25
**Related:** Production-Readiness plan Phase 1, T1.3, T1.2

## Decision

When `AgentOptions.conversationStorage` is `undefined`, the SDK constructs a `FileSystemConversationStorage` at `<workspaceCwd>/.theokit/agents/<id>/messages.jsonl` — byte-identical to pre-D303 behavior. `InMemoryConversationStorage` is the primary recommended adapter for unit tests and ephemeral dev/CLI sessions.

## Rationale

**Backward compatibility absolute (I1).** Apps that don't configure anything keep working unchanged. The default FS adapter delegates to the existing pure functions in `agent-session-store.ts` (`appendToSessionFile`, `readSessionFile`, `compactSessionFile`), preserving:

- Append-only JSONL semantics (crash-safe at line granularity)
- Redaction discipline (D68) — `redactSecrets` flows through the FS path
- Compaction every 50 appends + max 200 turns (D18)
- Path-traversal guard via `sanitizeIdentifier` + `safePathJoin` (D79-D81)

`InMemoryConversationStorage` is necessary because:
- SDK unit tests need to assert append semantics without FS noise
- CLI single-process dev (`theokit dev`) wants ephemeral history
- Test fixtures should not pollute `.theokit/agents/`

## Alternatives considered

- **Use only InMemory by default** — rejected. Breaks every existing app's persistence behavior. Massive backward-compat violation.
- **No default adapter; require explicit choice** — rejected. Forces every consumer to write boilerplate; defeats zero-config promise.

## Consequences

- Existing examples (`telegram-pro`, `slack-bot`, etc.) unchanged.
- FS adapter must NEVER regress redaction or compaction — tests pin both invariants.
- Custom storage callers must pass adapter on every `Agent.resume` call (see D325).
