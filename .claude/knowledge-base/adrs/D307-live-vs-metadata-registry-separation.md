# D307 — `Agent.registry` is a NEW live-cache module, separate from the metadata `agent-registry.ts`

**Status:** Accepted
**Date:** 2026-05-25
**Related:** Production-Readiness plan Phase 2, T2.1

## Decision

Production-Readiness #2 introduces `internal/runtime/live-agent-registry.ts` — a new module distinct from the existing `internal/runtime/agent-registry.ts`. The two solve different problems:

- **`agent-registry.ts` (existing, untouched at module boundary):** metadata persistence. `Map<agentId, RegisteredAgent>` + JSON write-through to `<cwd>/.theokit/agents/registry.json`. The "address book" — survives process restarts.
- **`live-agent-registry.ts` (new):** in-process cache of live `SDKAgent` instances. `Map<agentId, { agent, lastUsedAt }>` + LRU eviction + idle sweep. The "live working set" — purely in-memory, never persisted.

The public `Agent.registry` static surface points at the new live-cache singleton, NOT the metadata registry.

## Rationale

Conflating the two would violate SRP. The metadata registry needs:
- Cross-process durability (registry.json)
- Stable indexing by `cwd` (multi-workspace agents)
- Secret stripping (D17)

The live-cache needs:
- Process-local (no disk persistence — agent instances don't survive restart anyway)
- LRU + idle eviction (long-running servers)
- `dispose()` on eviction (release MCP servers, abort streams)

Layered: a `Map` of disposed agent metadata vs a `Map` of disposable agent instances. Different lifecycles, different invariants.

## Alternatives considered

- **Extend `agent-registry.ts` with eviction** — rejected. Mixed lifecycle (persist + dispose) makes reasoning hard. Tests would need to assert both disk + memory state per operation.
- **Eliminate the metadata registry entirely** — rejected. Agent.resume + Agent.list depend on cross-process metadata. Cannot replace without breaking the persistent agent contract.

## Consequences

- Both modules exist side-by-side. Two Maps in process — cheap (typically <1000 entries).
- docs.md and CLAUDE.md clearly distinguish "metadata registry" (lifecycle: persist) and "live registry" (lifecycle: cache).
- `Agent.delete` continues to operate on metadata; `Agent.registry.evict` operates on live cache. Both safe to call independently.
