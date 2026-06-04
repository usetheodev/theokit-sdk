# D423 — Subscription primitive ships Form 4 Hybrid (low-level + DSL)

- **Status:** Accepted
- **Date:** 2026-06-04
- **Plan:** `g8-streaming-websocket-sse-resume-plan`

## Decision

G8 ships TWO layers in the SDK:
1. **Low-level primitives** — `createNodeWsAdapter()` + `encodeSseChunk()` + `parseSseW3C()` for advanced consumers (custom protocols, binary frames, MCP-over-WS bridges).
2. **High-level typed-RPC DSL** — `defineSubscription({input, output, handler})` on the server side + `subscribe(name, input, opts)` on the client side, importable from `@theokit/sdk/subscription`.

P#9 plugin-realtime (Onda 3) consumes the high-level surface; advanced consumers drop to low-level.

## Rationale

Convergence: P#5 plugin-db-drizzle, P#6 plugin-payments, P#7 plugin-email, P#8 plugin-storage all landed Form 4 Hybrid (interface + canonical impl + extension helper). G8 follows the same pattern.

- **Primitive-only** (rejected): forces every consumer to reinvent typed RPC over WS. Anti-aligned with SDK's typed-RPC ethos.
- **DSL-only** (rejected): hides primitive; advanced consumers blocked.
- **Polling fallback** (rejected): 2026 environments rarely require it; complicates contract.

## Consequences

Two public entry points per surface — `defineSubscription` (server) + `subscribe` (client) for 80% of consumers, raw adapter access for the 20%. Mirrors hono's `defineWebSocketHelper` + per-runtime adapter pattern.
