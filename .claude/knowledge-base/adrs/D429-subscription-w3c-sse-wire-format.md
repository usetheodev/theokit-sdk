# D429 — Subscription SSE wire format = W3C spec (independent of D38 Vercel AI Data Stream)

- **Status:** Accepted
- **Date:** 2026-06-04
- **Plan:** `g8-streaming-websocket-sse-resume-plan`

## Decision

G8's SSE encoder + parser implement pure W3C SSE (`event:`, `data:`, `id:`, `retry:`, `:` comment). Independent of the Vercel AI Data Stream v1 wire format (codes `o:` / `O:` / `d:` / `3:`) which stays locked by D38 for `streamAssistant` LLM streaming. Both formats coexist — different use cases, no overlap.

## Rationale

- **Reuse Vercel AI Data Stream** (rejected): that format is LLM-specific (partial/complete object codes); doesn't naturally express tracked event IDs (`id:` field is canonical W3C, not in Vercel format).
- **Custom binary protocol** (rejected): precludes browser-native `EventSource`; loses tooling support (curl, Chrome DevTools EventStream tab).

## Consequences

Universal browser standard — works with native `EventSource` API for free, including auto-reconnect + `Last-Event-ID` header (though G8 piggybacks `lastEventId` into the subscription input per D424 instead). The Vercel-compat path for `streamAssistant` stays untouched (zero regression to existing `useChat` / `useTheoAssistant` hooks).
