# D378 — Pricing canonical unit: USD per million tokens

- **Status:** Accepted
- **Date:** 2026-05-27
- **Plan:** `token-budget-cost-tracker-plan` (Phase 0)

## Context

Industry convention 2024+: `$/MTok`. Anthropic, OpenAI, Google publish prices as per-MTok ($3 input / $15 output for Sonnet). LiteLLM JSON ships `_cost_per_token` (per-token), OpenRouter API ships per-token strings.

## Decision

Internal `PricingEntry.{input,output,cacheRead,cacheWrite,reasoning}CostPerMillion: number` (USD per 1_000_000 tokens). Lookup normalizes from LiteLLM (× 1e6) and OpenRouter (× 1e6).

## Rationale

Numbers between $0.01 and $100 are human-readable in code review. Avoid `5e-6` scientific notation in source.

## Consequences

`computeCost` formula: `Math.round(tokens * costPerMillion * 1e6 / 1e6) / 1e6` (microcent precision).
