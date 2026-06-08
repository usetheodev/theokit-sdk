# Changelog — @theokit/sdk-budget

## [Unreleased]

## [0.1.0] — 2026-06-08

### Added
- Initial release. Consumes the `BudgetTracker` port from `@theokit/sdk@>=1.7.0`
  (SDK 2.0 Phase 2 / T2.X).
- `createUsdBudgetTracker({ maxTokens?, maxUsd?, pricing? })` — USD-cost-
  aware tracker extending sdk-core's counter-based reference.
  `check()` returns `cost_limit` reason when `maxUsd` is exceeded.
- `BUILTIN_PRICING` (read-only) — built-in pricing table for 9 popular
  models across OpenAI / Anthropic / Google (verified 2026-06).
- `computeUsdCost(pricing, model, type, tokens)` — pure helper.

### Notes
- Live-rate fetching / ledger persistence / per-user aggregation deferred
  to future versions. This release ships the package foundation + a
  working USD impl so the SDK 2.0 cohort can publish (Phase 7).
- `peerDependency`: `@theokit/sdk >= 1.7.0` (where the port shipped).
