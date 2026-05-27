# D379 — Pricing snapshot bundled, manual refresh

- **Status:** Accepted
- **Date:** 2026-05-27
- **Plan:** `token-budget-cost-tracker-plan` (Phase 0)

## Context

LiteLLM JSON ships 2500+ models with `_cost_per_token` + `litellm_provider`. Lazy fetch on first call introduces latency; manual cron is auditable.

## Decision

Bundle a snapshot of [LiteLLM `model_prices_and_context_window.json`](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json) inside `packages/sdk/src/internal/budget/pricing-data.json`. Refresh via `scripts/refresh-pricing.mjs` (manual, monthly).

## Rationale

- Bundled = always online, predictable latency.
- Manual = auditable; auto-update could pull wrong-price into prod.
- Concept page directs users to OpenRouter `/api/v1/generation/{id}` for live reconciliation of OR routes.

## Consequences

Snapshot can stale between releases. `pricingVersion` field exposes the version date so UI can warn. EC-22 documents staleness explicitly.
