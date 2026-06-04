# D430 — Subscription auto-route via theokit/server `theokit.subscriptions` namespace (cross-repo)

- **Status:** Accepted (SDK-side primitives shipped v1.7.0; theokit-side wiring cross-repo follow-up)
- **Date:** 2026-06-04
- **Plan:** `g8-streaming-websocket-sse-resume-plan`

## Decision

SDK ships:
- `scanSubscriptions({appDir, outFile})` — walks `<appDir>/app/subscriptions/**/*.ts`, derives names, emits `.theo/subscriptions.json` manifest mirroring routes/actions manifest shape (G6 router convention).
- `mountSubscriptions({manifest, appDir, runtime?})` — reads manifest, dynamic-imports each descriptor file, registers in `SubscriptionRuntime`, returns `{handleSseRequest, handleWsUpgrade}` handlers ready to wire into `http.Server`.

theokit-side wiring (Vite plugin scan emission at build time + http upgrade listener registration at dev/start time) lands in a **sibling theokit task** (cross-repo follow-up, tracked in plan EC-7).

## Rationale

- **Manual registration** (`app.subscriptions.register(handler)`, rejected): breaks G6 convention-based-routing philosophy.
- **Co-located with routes** (`app/routes/x.ts` exports both `GET` and `SUBSCRIPTION`, rejected): mixes paradigms; subscriptions are long-lived (different lifecycle than HTTP requests); operational ergonomics diverge.

## Consequences

Consumers using TheoKit get auto-wired subscriptions via the file convention. SDK-only consumers (no theokit) can manually mount via `mountSubscriptions` + their own `http.Server`. Convention identical to G6 routes scanner — predictable, tooling-friendly.
