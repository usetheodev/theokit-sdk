---
"@theokit/sdk": minor
---

G8 — Subscription primitive (WebSocket + W3C SSE + opaque resume tokens) at `@theokit/sdk/subscription` sub-path. Ships Form 4 Hybrid per ADRs D423-D430:

- **`defineSubscription`** — typed RPC factory with Zod input/output + AsyncGenerator handler
- **`subscribe`** — client-side AsyncGenerator with transparent reconnect + `lastEventId` propagation
- **`tracked`** + **`isTrackedEnvelope`** — opaque resume token envelope helpers (server-defined semantics)
- **`SubscriptionTransport`** — `'ws' | 'sse' | 'auto'` (default auto = WS-preferred, SSE fallback)
- **`SubscriptionError`** / **`SubscriptionInputError`** / **`SubscriptionDisconnectError`** — typed error hierarchy extending `TheokitAgentError`
- **`createNodeWsAdapter`** — canonical Node `ws` adapter (optional peer; dynamic `import('ws')`)
- **`encodeSseChunk`** / **`parseSseW3C`** — W3C SSE encoder + parser (independent of D38 Vercel AI Data Stream)
- **`scanSubscriptions`** + **`mountSubscriptions`** — file-based scanner emitting `.theo/subscriptions.json` + http handlers for SSE GET / WS upgrade

Additive — no breaking changes. CF Workers / Bun / Deno per-runtime adapters deferred to v1.8.x as separate packages.
