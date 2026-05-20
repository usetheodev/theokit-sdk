# D147 — `MemoryContext` is minimal; only `userId` is required

**Date:** 2026-05-20
**Status:** Accepted

## Decision

`MemoryContext` (D141) defines:

```ts
interface MemoryContext {
  userId: string;          // REQUIRED — lowest common denominator
  agentId?: string;        // optional
  sessionId?: string;      // optional
  tenantId?: string;       // optional
  tags?: string[];         // optional
  metadata?: Record<string, unknown>;
}
```

Each adapter translates optional fields to its provider's native
primitive:

| Field | Supermemory | Honcho | Mem0 |
|---|---|---|---|
| `userId` | containerTag `user:` | `peer(userId)` | `user_id` |
| `agentId` | containerTag `agent:` | (peer in session) | `agent_id` |
| `sessionId` | metadata | `session(userId:sessionId)` (EC-D) | `run_id` |
| `tenantId` | containerTag `tenant:` | `workspaceId` | `app_id` |
| `tags` | containerTags `tag:` | metadata | `categories` |

## Rationale

Research confirmed: across Supermemory, Honcho, Mem0 the ONLY field
present as first-class in all three is `userId`. Anything else needs
adapter-side translation. A minimum-viable shared context lets the
same `MemoryContext` work for all three (and future adapters) without
caller-side conditionals.

## Consequences

- **Enables:** portable code — same context shape across adapters.
- **Constrains:** provider-specific features (Mem0 `history(id)`,
  Honcho dialectic depth, Supermemory profile facts) need
  adapter-specific options structs. Documented per adapter.
