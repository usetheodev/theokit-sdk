---
id: D13
status: Decided
date: 2026-05-16
plan: sdk-v1-ga-completion
---

# D13 — Active Memory `subagent` mode (LLM-curated) deferred to v1.1

## Context
OpenClaw's Active Memory supports two recall modes: `search` (direct FTS+vector hybrid) and `subagent` (a tiny LLM curates which memory facts are relevant before injection). The previous SDK iteration exposed `mode: "search" | "subagent"` in `ActiveMemoryOptions` but never implemented the subagent branch. Under the no-stubs rule, the `mode` field was removed entirely.

## Decision
v1.0 ships `search` mode only. The `mode` field is absent from `ActiveMemoryOptions`. `subagent` mode is deferred to v1.1.

## Rationale
- `search` mode (direct FTS+vector hybrid) works well at v1.0 scale and is already exercised in dogfood (`examples/active-memory` returns "8675309" from injected memory).
- `subagent` mode requires:
  - A tiny model picker (Haiku 4.5 / Gemini Flash Lite — which one is default? user-configurable?).
  - A curation prompt template (the OpenClaw template is a starting point but needs adaptation).
  - Cost accounting for the extra LLM call per `send()` — what's the budget signal?
- Each decision is its own ADR. Shipping without `subagent` is honest; shipping a half-baked subagent isn't.

## Consequences
- `ActiveMemoryOptions` has no `mode` field; defaults are direct-search.
- The return contract (`summary: string | undefined`) accommodates either mode without API change in v1.1.
- v1.1 work: pick default tiny-model, prompt template, cost-signal API.

## Alternatives Considered
- **Ship subagent with a hardcoded model** — rejected; locks consumers into one provider.
- **Ship as opt-in stub** — rejected; violates no-stubs rule.
