# D310 — `Agent.registry.configure()` is last-call-wins (process-wide singleton)

**Status:** Accepted
**Date:** 2026-05-25
**Related:** Production-Readiness plan Phase 2, T2.5

## Decision

`Agent.registry` is a process-wide singleton (the `liveAgentRegistry` instance exported from `internal/runtime/live-agent-registry.ts`). `Agent.registry.configure(opts)` mutates the singleton state — last call wins for ALL subsequent operations across the process.

There is NO per-Agent or per-test instance of the registry.

## Rationale

**Live cache only makes sense globally.** If Agent A configures `maxAgents: 5` but Agent B uses default 100, the registry's behavior depends on which one wrote last. That's a footgun — semantics depend on initialization order.

Matches existing process-wide singletons in the SDK:
- `CredentialPool` (D123) — one credential pool per process via ALS
- `Cron` (D7) — one scheduler

## Alternatives considered

- **Per-Agent config** — rejected. Inconsistent behavior across agents in the same process.
- **`Agent.createRegistry()` returning a new instance** — rejected. Two registries in the same process compete on `dispose()` — the first to evict releases the agent, the second's reference is stale.

## Consequences

- Tests need `await Agent.registry.evictAll()` in `beforeEach`/`afterEach` to avoid cross-test contamination. Pattern is the same as `clearAgentRegistry()` for metadata registry.
- Configuration is global — library consumers must coordinate (e.g., Express app config calls `configure` once at boot).
