# D376 — `TokenUsage` shape: 5 closed buckets

- **Status:** Accepted
- **Date:** 2026-05-27
- **Plan:** `token-budget-cost-tracker-plan` (Phase 0)

## Context

Anthropic exposes 4 token buckets (`input/output/cache_read/cache_write`); OpenAI o-series adds `reasoning_tokens`. Mastra ships 10 meters; Hermes ships 5; openai-agents-python ships 4 with details.

## Decision

`TokenUsage` carries 5 fields: `inputTokens`, `outputTokens`, `cacheReadTokens?`, `cacheWriteTokens?`, `reasoningTokens?`, plus derived `totalTokens` and optional `requests[]` breakdown.

## Rationale

5 covers 100% of providers 2026. Audio/image/text breakdown is deferred to v0.2 (signal-to-noise too low for v1).

## Consequences

Multi-modal apps still receive correct total but lose modality breakdown. EC-10 invariant: `totalTokens === inputTokens + outputTokens`.
