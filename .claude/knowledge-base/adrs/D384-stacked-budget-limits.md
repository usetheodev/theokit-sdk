# D384 — Budget limits are stacked; ANY exceeded blocks

- **Status:** Accepted
- **Date:** 2026-05-27
- **Plan:** `token-budget-cost-tracker-plan` (Phase 0)

## Context

LiteLLM/Bifrost: usuário típico quer "$1/day AND $20/month" stacked. Pass-all-tiers semantics.

## Decision

`limits: BudgetLimit[]` is an array; for each enforcement: iterate all; if ANY would-exceed, block (or warn). Order doesn't matter.

## Rationale

Composite enforcement matches user mental model. Empty `limits[]` = informational-only (EC-19).

## Consequences

O(limits) check per preflight; tipicamente ≤ 3 — desprezível. Multi-window combinations explicit.
