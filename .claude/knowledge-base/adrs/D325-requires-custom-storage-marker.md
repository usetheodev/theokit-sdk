# D325 — `requiresCustomStorage` registry marker for strict resume

**Status:** Accepted
**Date:** 2026-05-25
**Related:** Production-Readiness plan Phase 1, T1.5; absorbed from edge-case review EC-3

## Decision

When `Agent.create` is called with a non-undefined `AgentOptions.conversationStorage`, the SDK persists a `requiresCustomStorage: true` marker in the registry (`registry.json` snapshot). `Agent.resume` checks this marker — if `true` and the caller did NOT pass `conversationStorage` again, throws:

```
ConfigurationError(code: "conversation_storage_required")
```

with a message instructing the caller to pass the adapter again.

## Rationale

**Prevents silent data loss.** Without this gate, a Postgres-backed agent restored across process restart would:
1. Hit the FS fallback (default `FileSystemConversationStorage`).
2. Read `.theokit/agents/<id>/messages.jsonl` — which does NOT exist for a Postgres agent.
3. Return `[]` for history.
4. Continue the conversation as if it were fresh, while the user's prior turns sit unread in Postgres.

The Production-Readiness handoff specifically calls out that users moving to serverless need persistence safety. The marker is the only safe default — stronger fail beats silent corruption (Inviolable Rule 8 — "fail high, fail early, fail clear").

## Alternatives considered

- **Silent FS fallback with stderr warn** — rejected. Stderr warnings are routinely missed in containerized deploys (PaaS log aggregation often hides them). User would discover the corruption months later.
- **Auto-construct fresh adapter from environment** — rejected. Requires extending the registry serializer with adapter-construction metadata (DSN, connection params) which leaks secrets and tightly couples the SDK to specific backends.
- **No check at all (legacy behavior)** — rejected. This is the bug.

## Consequences

- TheoKit's wrapper (`createConversationHistory`) must always thread `conversationStorage` through to `Agent.getOrCreate` / `Agent.resume`. Documented in `docs/recipes/conversation-storage-{postgres,redis}.md`.
- Pre-D303 apps that never set `conversationStorage` have `requiresCustomStorage: undefined` in registry → resume succeeds as before. Backward compatible.
- The marker is persisted via `agent-registry-store.ts` (`toSerialized` / `fromSerialized`). Adds 1 field per registered agent — negligible disk impact.
