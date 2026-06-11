# Changelog — @theokit/sdk-budget

## [Unreleased]

### Added (Phase 2 physical Stage 1 — iter 19, 2026-06-08)
- Physically-extracted Budget internals into `sdk-budget/src/internal/`:
  - `calendar-window` — UTC-aligned 1h/1d/1w/30d/365d window helpers.
  - `enforcement` — `preflightCheck` + `chargeAndCheckThresholds` with
    onThreshold + onExceed dispatch.
  - `ledger` — `charge` + `spentIn` ledger ops (consumes the new public
    `withCwdMutex` utility from `@theokit/sdk` per ADR-008).
  - `normalize-usage` — `inferApiMode` + `normalizeUsage` (Anthropic /
    OpenAI Chat / OpenAI Responses shape detection).
  - `registry` — `createBudget` / `getBudget` / `listBudgets` /
    `deleteBudget` / `snapshotAll` / `defaultMode` / `getBudgetOptionsRaw`.
- Public exports added to the main barrel:
  `createBudget, defaultMode, deleteBudget, getBudget, getBudgetOptionsRaw,
  listBudgets, snapshotAll, chargeAndCheckThresholds, preflightCheck,
  inferApiMode, normalizeUsage, startOfDayUtc, startOfWeekUtc,
  windowStartMs, charge, spentIn`.

### Changed (iter 19)
- Package now ships ~568 LOC of canonical Budget logic (was 0 LOC pre-Stage-1).
- Bundle size: 2.51 KB → 13.47 KB ESM (the extracted internals).
- `peerDependency`: `@theokit/sdk >= 1.7.0` confirmed (ADR-008's
  public `withCwdMutex` is required).

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
