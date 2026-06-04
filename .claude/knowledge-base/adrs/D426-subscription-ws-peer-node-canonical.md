# D426 — `ws` Node-only canonical adapter; multi-runtime adapters deferred to 1.8.x

- **Status:** Accepted
- **Date:** 2026-06-04
- **Plan:** `g8-streaming-websocket-sse-resume-plan`

## Decision

v1.7.0 ships canonical `createNodeWsAdapter()` requiring `ws@>=8.0.0` as **optional peer** (per `peerDependenciesMeta`). Dynamic `import('ws')` at first use with actionable `SubscriptionError` when peer missing. Consumer-supplied adapters accepted via `WsAdapter` interface for advanced (custom binary, vendored runtimes).

Cloudflare Workers + Bun + Deno adapters land in **v1.8.x** as separate packages (`@theokit/sdk-ws-cloudflare`, `-bun`, `-deno`) — same hono-style per-runtime package pattern.

## Rationale

- **`crosws` vendored** (nitro pattern, rejected): adds extra dep tree; crosws still pre-1.0; abstraction leaks more than per-runtime packages.
- **Multi-runtime in v1.7** (rejected): blast radius too wide; Cloudflare DO hibernation alone is a 2-week spike (partykit complexity per blueprint EC-3).
- **No WS in v1.7, SSE-only** (rejected): punts on G8 promise; P#9 plugin-realtime blocked.
- **`ws` REQUIRED peer** (rejected after EC-8 absorption): would force SSE-only consumers to install ws. Optional peer + dynamic-import with actionable error keeps SSE-only path zero-cost.

## Consequences

Node 22+ canonical path ready immediately; advanced consumers can BYO adapter via the `WsAdapter` interface. EC-6 multi-runtime API divergence (CF no `onOpen`, Bun env-coupling, Deno upgrade quirks) absorbed by deferring to per-runtime packages in 1.8.x.
