# D136 — `Agent.batch` default concurrency = 4

**Date:** 2026-05-20
**Status:** Accepted

## Decision

`BatchOptions.concurrency ?? 4`. Capped to `prompts.length` to avoid
spinning idle workers (EC-3). Throws `ConfigurationError` on
zero/negative/non-integer values (EC-2).

## Rationale

Matches Hermes-Agent (`--num_workers=4`). Empirically the sweet spot for
free-tier provider rate limits — most OpenAI/Anthropic/OpenRouter tiers
allow 4+ concurrent requests per key without throttling.

A higher default (e.g., 8 or 16) would burn through rate limits on
free-tier accounts in the first batch, surfacing 429s as user errors
during initial integration. A lower default (e.g., 1) would surprise
callers expecting parallelism from a method named `batch`.

## Consequences

- **Enables:** sensible default for first-time callers; no required
  config to get parallel execution.
- **Constrains:** users with paid quotas might want higher concurrency —
  documented in JSDoc with a one-liner example
  (`{ concurrency: 16 }`).
