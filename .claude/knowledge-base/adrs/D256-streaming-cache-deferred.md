# D256 — Streaming cache deferred to v1.x; v1 caches `agent.send` only

**Date:** 2026-05-22
**Status:** Accepted

## Decision

v1 intercepts `pre_user_send` + captures `post_assistant_reply` with complete text. Streaming (`agent.stream`) is NOT cached — replay would be single-chunk pseudo-stream, losing UX.

## Rationale

Vercel AI SDK shows the pattern (cache chunks + `simulateReadableStream`), but it's fragile (timing replay, partial decode edge cases). Defer until measurable demand.

## Consequences

- Stream-first apps use Anthropic prompt_caching as complement (D263).
- Forward-compat: `Cache.semantic({ streaming: true })` added when shipping.
