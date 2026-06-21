# Edge Case Review — m1-usage-honest-null (PLAN cycle)

Date: 2026-06-21
Plan analyzed: knowledge-base/plans/m1-usage-honest-null-plan.md
Tasks analyzed: 2 (T1.1 fix, T2.1 record)
Edge cases found: 3 (MUST FIX: 0, SHOULD TEST: 1, DOCUMENT: 2)

## Boundary map
Pure cost-accounting edit. Live edge family: poison stickiness + interaction of the cost cap with both caps + the known-zero vs unknown distinction. No I/O.

## MUST FIX
(none — poison + fail-closed + honest-null are ADR D1/D2/D3 + T1.1 TDD; the known path is regression-tested.)

## SHOULD TEST

### EC-1: poison + token cap together — when cost is unknown AND tokens exceed maxTokens, the deny reason order
- **Affected task:** T1.1
- **Family:** State
- **Scenario:** maxUsd AND maxTokens both set, an unknown-cost round pushes tokens over maxTokens. `check()` evaluates maxUsd first → would return `cost_limit` (fail-closed) even though the token cap is also exceeded. The order (cost_limit before token_limit) must be deliberate and tested so the reason is predictable.
- **Suggested test:** `test_check_unknown_cost_precedes_token_limit` — both caps set, unknown round over both → assert reason === "cost_limit" (cost check runs first; document the precedence).

## DOCUMENT

### EC-2: a pricing override that ADDS the model un-poisons future rounds, not past ones
- **Accepted risk:** poison is per-tracker-instance and sticky; supplying `options.pricing` for the model only affects rounds tracked AFTER the override is in place (the override is set at construction, so in practice the model is known from the start). No mid-run override exists. Documented.

### EC-3: `getTotal().tokens` is always a number even when cost is unknown
- **Accepted risk:** tokens are always known (from `event.tokens`); only USD becomes undefined. `getTotal()` (tokens+iterations) is unaffected — only `getTotalUsd()` returns undefined. Documented.

## Summary

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T1.1 | 3 | 0 | EC-1 | EC-2, EC-3 |
| T2.1 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN OK (1 SHOULD TEST — cost-limit precedes token-limit under unknown — fold into T1.1 TDD; no MUST FIX)
