# D425 — Subscription transport selection: `'ws' | 'sse' | 'auto'` with auto = WS-preferred

- **Status:** Accepted
- **Date:** 2026-06-04
- **Plan:** `g8-streaming-websocket-sse-resume-plan`

## Decision

`subscribe(name, input, { transport })` accepts `'ws' | 'sse' | 'auto'`. Default `'auto'` prefers WS when a global `WebSocket` constructor exists, else falls back to SSE. Strict modes (`'ws'`, `'sse'`) skip the fallback and surface a transport-specific error when unavailable.

## Rationale

- **WS-only** (Socket.IO pre-2025 default, rejected): forces clients to upgrade; some intranet proxies + old CDNs still block WS.
- **SSE-only** (rejected): precludes bidirectional flows G8 promises (client-side commands over a single WS, not one HTTP per call).
- **Always-WS-with-polling-fallback** (Engine.IO, rejected): polling fallback is legacy; 2026 environments rarely require it; doubles transport surface.

## Consequences

SSE handles 80% of subscription use cases (server-pushed events, browser-native EventSource); WS handles bidirectional + lower latency. Auto-selection mirrors Socket.IO's graceful-degradation spirit without inheriting its polling legacy. Consumer can pin transport when they know the deployment constraints.
