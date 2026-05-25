# D308 — `Agent.registry` defaults: maxAgents=100, idleTimeoutMs=30min, sweep=60s

**Status:** Accepted
**Date:** 2026-05-25
**Related:** Production-Readiness plan Phase 2, T2.1

## Decision

Default configuration:
- `maxAgents: 100`
- `idleTimeoutMs: 1_800_000` (30 minutes)
- `sweepIntervalMs: 60_000` (60 seconds)

Calibrated for indie/small-team Node deploys.

## Rationale

**maxAgents: 100** — ~500MB working set at typical SDK memory (~5MB per agent: MCP server pool, plugin registry, conversation cache, file handles). Inside Heroku/Railway/Render free-tier envelopes. High-traffic SaaS should set 1000+; memory-constrained dev should set lower.

**idleTimeoutMs: 30min** — Captures the natural "coffee break" gap in chat sessions. Aggressive enough to evict abandoned conversations; lenient enough that users who step away briefly don't re-pay initialization cost.

**sweepIntervalMs: 60s** — Sweep is best-effort cleanup, not a hot path. 1s would waste CPU; 10min would let stale entries linger. 60s is the middle.

## Alternatives considered

- **maxAgents: 1000** — rejected as default. 5GB working set crashes hobby tiers. Power users can configure up.
- **maxAgents: 10** — rejected. Triggers LRU thrashing in mid-traffic apps.
- **idleTimeoutMs: 5min** — rejected. Too aggressive — users returning from a meeting hit fresh-create cost every time.

## Consequences

- Zero-config sane production for the bulk of consumers.
- Documented in docs.md "Agent Registry Lifecycle" with examples for the two extremes.
- High-traffic deploys MUST configure to avoid 100-cap thrashing — surfaced via `onEvict` listener (telemetry signal).
