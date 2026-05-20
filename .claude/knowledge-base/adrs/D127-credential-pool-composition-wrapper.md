# D127 — `PoolAwareLlmClient` is a composition wrapper, not a base class

**Date:** 2026-05-20
**Status:** Accepted

## Decision

`PoolAwareLlmClient implements LlmClient` and is constructed with a real `LlmClient` builder callback `(apiKey: string) => LlmClient`. Wraps every provider transparently. `FallbackLlmClient` keeps wrapping pool-aware clients — chain reads `Fallback(PoolAware(OpenAIClient))`.

## Rationale

`LlmClient` is a 2-method interface `{ name, stream(req, signal) }`. Composition preserves the contract — `FallbackLlmClient` doesn't need to know about pools. Subclassing would couple pool concerns to every provider implementation; lazy build via callback keeps providers ignorant of pool existence.

## Consequences

- **Enables:** Pool layer independently testable; can be disabled by skipping the wrap; cross-provider fallback unchanged.
- **Constrains:** Tiny allocation per HTTP call (a closure + a real client) — measured <1µs, negligible.
