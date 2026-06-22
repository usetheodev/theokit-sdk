# Changelog — @theokit/sdk-budget

## 0.2.0

### Minor Changes

- 1706517: M1-6 — multi-round usage aggregation is honest-null (plan `m1-usage-honest-null`).

  Fixes a cost-honesty bug: `computeUsdCost` returned `0` for an unknown model, so a per-round cost that is genuinely UNKNOWN was silently summed as `$0`, making `createUsdBudgetTracker.getTotalUsd()` report a dishonest cheap/complete total and a `maxUsd` cap evaluate against an under-counted spend.

  - `computeUsdCost(...)` now returns `number | undefined` — `undefined` for an unknown model (a known model with zero tokens still returns a real `0`). Aligns with the cost contract (`D377-cost-status-closed-enum.md`: amount-unknown ≠ `$0`), matching `@theokit/sdk/messages`' `costAmountUsd`.
  - `createUsdBudgetTracker` POISONS the aggregate: once any round's cost is unknown, `getTotalUsd()` returns `undefined` (and stays undefined — a later known round does not resurrect it). Tokens are always known and still counted.
  - `check()` FAILS CLOSED on a `maxUsd` cap when cost is unknown (returns `cost_limit` — it cannot prove the run is under budget). The `maxTokens` cap is unaffected.

  **Type change:** `computeUsdCost` and `getTotalUsd()` now return `number | undefined` (was `number`). Consumers must branch on `undefined` (the point of the honest-null contract).

## [Unreleased]

### Fixed

- **Multi-round usage aggregation is honest-null (M1-6).** `computeUsdCost` returned `0` for an unknown model, so a per-round cost that is genuinely UNKNOWN was silently summed as `$0` — making `getTotalUsd()` report a dishonest cheap/complete total and a `maxUsd` cap evaluate against under-counted spend. Now: `computeUsdCost(...): number | undefined` returns `undefined` for an unknown model (a known model with zero tokens still returns a real `0`); `createUsdBudgetTracker` poisons the aggregate so `getTotalUsd(): number | undefined` returns `undefined` once any round's cost is unknown (sticky; tokens still counted); `check()` fails closed on a `maxUsd` cap when cost is unknown (`cost_limit`). Aligns with the cost contract `D377-cost-status-closed-enum.md`. **Type change:** `computeUsdCost`/`getTotalUsd()` now return `number | undefined`.

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
