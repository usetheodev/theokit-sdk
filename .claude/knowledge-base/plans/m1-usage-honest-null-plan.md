---
slug: m1-usage-honest-null
created_at: 2026-06-21
goal: Fix the dishonest `return 0` for unknown-model cost in @theokit/sdk-budget so an unknown per-round cost poisons the aggregate to undefined (never $0) and a maxUsd cap fails closed when cost is unknown, measured by tests/usd-budget-tracker.test.ts passing green.
---

# Plan: M1-6 — Multi-round usage aggregation (honest-null)

> **Version 1.1** (edge-case-plan absorbed: EC-1 cost-limit-precedes-token-limit folded into T1.1 TDD) — Fix the cost-honesty bug in `@theokit/sdk-budget`: `computeUsdCost` returns `0` for an unknown model (`usd-pricing.ts:50`), so a round whose cost is unknown silently sums `0` into the total, reporting a dishonest cheap/complete `$X.XX` when the true cost is UNKNOWN. Change `computeUsdCost` to return `number | undefined` (`undefined` = unknown model; keep `0` only for the known-model-zero-tokens case), and make `createUsdBudgetTracker` POISON the aggregate: once any round's cost is unknown, `getTotalUsd()` returns `undefined` (tokens still counted) and `check()` fails closed on a `maxUsd` cap (cannot prove under budget). Honors the cost-honesty contract `D377-cost-status-closed-enum.md` (amount unknown ≠ `$0`), mirroring M1-5's `costAmountUsd`. Closes roadmap gap M1-6 — the last M1 item (Tema A).

## Goal

> "Make an unknown per-round cost poison the aggregate to `undefined` (never `$0`) in `@theokit/sdk-budget`, with a `maxUsd` cap failing closed on unknown cost — measured by `tests/usd-budget-tracker.test.ts` passing green."

## Context

Roadmap gap M1-6 (`docs/gap-audit/ROADMAP.md:94`, low sev, size M, dep M1-5 ✅). The bug: `computeUsdCost` (`packages/sdk-budget/src/usd-pricing.ts:48-54`) is typed `: number` and does `if (entry === undefined) return 0` at `:50` — an unknown model reports `$0`. `createUsdBudgetTracker.track` (`packages/sdk-budget/src/usd-budget-tracker.ts:63`) does `totalUsd += computeUsdCost(...)`, so an unknown round silently contributes `0`, and `getTotalUsd()` (`:88`) returns a dishonest complete total; `check()` (`:67`) evaluates `maxUsd` against that under-counted total. This contradicts the cost-honesty contract (`D377-cost-status-closed-enum.md`: `amountUsd` is `number | undefined` where `undefined` = unknown, distinct from a real `$0`), which the SDK's own `computeCost` (`packages/sdk/src/internal/budget/compute-cost.ts:74-81`) and M1-5's `costAmountUsd` (`packages/sdk/src/messages.ts:45-52`) already honor. This is a BUG FIX (regression test first). Respects `rules/architecture.md` + `rules/no-stubs-no-mocks-no-wired.md`. Zero new deps.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk-budget/src/usd-pricing.ts` | 55 | — | `BUILTIN_PRICING` + `computeUsdCost` | keep known-model math; only unknown-model → undefined |
| `packages/sdk-budget/src/usd-budget-tracker.ts` | 96 | — | `createUsdBudgetTracker` (track/check/getTotalUsd) | keep token counting + cap contract; add cost poisoning |
| `packages/sdk-budget/tests/usd-budget-tracker.test.ts` | 188 | — | tracker + pricing tests | flip the 2 bug-asserting tests; add regressions |
| `packages/sdk-budget/CHANGELOG.md` | — | — | per-package changelog | additive Fixed entry |
| `CHANGELOG.md` (root) + `.changeset/` (NEW) | — | — | workspace changelog + changeset | additive Fixed entry |

### Current callers / dependents

- **`computeUsdCost`** (exported from the `@theokit/sdk-budget` barrel, `src/index.ts`) — called by `createUsdBudgetTracker.track` (`usd-budget-tracker.ts:63`) and directly by tests. Return-type change `number` → `number | undefined` is a type-surface change (pre-1.0 package `@theokit/sdk-budget@0.1.0`); the only in-repo caller is the tracker (updated in the same task).
- **`createUsdBudgetTracker`** — `getTotalUsd()` return type changes `number` → `number | undefined`. Consumers reading the total must branch on `undefined` (the honest-null contract; the point of the fix).
- **`D377-cost-status-closed-enum.md`** + M1-5 `costAmountUsd` — the contract this aligns to (read-only).

### Domain glossary

- **honest-null** — an unknown cost is represented as `undefined`, NEVER coerced to `0` (`$0` is a real known cost, e.g. a subscription-included route).
- **poison** — once any per-round cost is unknown, the aggregate total becomes `undefined` and stays `undefined` (a later known round does not resurrect it).
- **fail-closed** — when a `maxUsd` cap is set but the cumulative cost is unknown, `check()` denies (cannot prove the run is under budget) rather than silently allowing unbounded spend.

### Architecture boundaries affected

`usd-pricing.ts` + `usd-budget-tracker.ts` are pure domain logic in `@theokit/sdk-budget` (no I/O). The fix changes two public return types within this package; it imports only `BudgetTracker`-family types from `@theokit/sdk` (existing peer). No DIP boundary crossed.

## Prior Art & Related Work

- **In-repo contract** `D377-cost-status-closed-enum.md` (the cost-status enum + amount-unknown-≠-$0 rule); the SDK's `compute-cost.ts:74-81` (unknown → `amountUsd: undefined, status:"unknown"`); M1-5's `costAmountUsd` (`packages/sdk/src/messages.ts:45-52`) — all already honor honest-null. This fix brings `@theokit/sdk-budget` into line.
- (none external — this is an internal correctness fix in our own code; the DISCOVER cycle does not apply to locating/fixing a symbol in our own code, so no blueprint is cited here.)

## Objective

- [ ] `computeUsdCost(...): number | undefined` — `undefined` for an unknown model; `0` only for known-model zero/invalid tokens.
- [ ] `createUsdBudgetTracker.getTotalUsd(): number | undefined` — `undefined` once any round's cost is unknown (poisoned); tokens still counted.
- [ ] `track` poisons on an unknown-cost round (does not add `0`); a later known round does not un-poison.
- [ ] `check()` with `maxUsd` set returns `{allowed:false, reason:"cost_limit"}` when cost is unknown (fail-closed); token cap unaffected.
- [ ] The 2 bug-asserting tests flipped; regression tests added; zero new deps; changeset + CHANGELOG (root + package).
- [ ] `tests/usd-budget-tracker.test.ts` green; typecheck + Biome clean; build emits dist.

## ADRs

### D1 — `computeUsdCost` returns `number | undefined`; unknown model → `undefined`
**Decision:** change the return type to `number | undefined`; `return undefined` when `pricing[model]` is absent; keep `return 0` for the known-model zero/invalid-token case (a real `$0`).
**Rationale:** aligns with `D377-cost-status-closed-enum.md` + the SDK's `compute-cost.ts` (unknown → `amountUsd: undefined`); the reason a cost is unknown (no pricing) must not masquerade as `$0`.
**Alternatives considered:** keep `0` + a separate `known` flag in the return (rejected — `number | undefined` is the established contract; a flag duplicates it); throw on unknown (rejected — `track` is non-throwing by contract).

### D2 — Tracker poisons the aggregate (honest-null), tokens still counted
**Decision:** track a `costKnown` flag; on an unknown-cost round set `costKnown=false` and do NOT add to `totalUsd`; tokens are always summed; `getTotalUsd()` returns `costKnown ? totalUsd : undefined`. Once poisoned, stays poisoned.
**Rationale:** a single unknown round makes the TOTAL unknown — reporting the partial known sum as the total would be the same dishonesty in a new place. Tokens are always known (from `event.tokens`), so token counting is unaffected.
**Alternatives considered:** report the partial known sum (rejected — dishonest total); make `totalUsd` itself `number|undefined` and stop adding after the first undefined (equivalent; the flag is clearer and preserves the partial for diagnostics if ever needed — but we expose `undefined`).

### D3 — `check()` fails closed on `maxUsd` when cost is unknown
**Decision:** when `maxUsd !== undefined` and cost is unknown (`!costKnown`), `check()` returns `{allowed:false, reason:"cost_limit", detail:"cost unknown — cannot verify maxUsd"}`. The `maxTokens` cap is evaluated normally (tokens are known).
**Rationale:** a spend cap that treats unknown cost as `$0` would let spend run unbounded — the same dishonesty as the original bug, in the enforcement path. Fail-closed is the safe, honest default for a money cap (Unbreakable error-handling: fail closed for the catastrophic case).
**Alternatives considered:** ignore the usd cap when unknown (rejected — silently lets unbounded spend through, defeating the cap); throw (rejected — `check()` is non-throwing).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Return-type change (`number`→`number\|undefined`) is a type-surface change for `computeUsdCost`/`getTotalUsd` | Medium | pre-1.0 package (`@theokit/sdk-budget@0.1.0`); the only in-repo caller is updated in the same task; changeset documents the type change; it is the intended honest contract | SDK |
| `check()` fail-closed denies a run that uses one unknown-priced model under a `maxUsd` cap | Low | documented behavior; the fix is opt-in to honesty — a consumer wanting to allow unknown-priced models supplies pricing overrides (already supported via `options.pricing`) | SDK |
| A consumer reading `getTotalUsd()` as `number` now gets `undefined` | Low | that is the bug being fixed — they MUST branch on unknown (the honest-null contract); changeset + CHANGELOG flag it | SDK |

## Unresolved Questions

- (none — every decision is resolved at plan time: the scope is the `return 0` honest-null bug + its aggregation/enforcement consequences. Broader cost reconciliation, e.g. OpenRouter `/generation`, is explicitly out of scope — a separate concern.)

## Dependency Graph

```
Phase 1 (fix computeUsdCost + tracker poisoning + check fail-closed + tests) ──▶ Phase 2 (changeset + CHANGELOG root/package) ──▶ Final Phase (integration validation)
```

---

## Phase 1: The honest-null fix

### T1.1 — Fix `computeUsdCost` + tracker poisoning + `check` fail-closed (bug fix, regression test first)

#### Objective
Make unknown cost honest-null end to end: `computeUsdCost` → `undefined`; tracker poisons `getTotalUsd()`; `check()` fails closed on `maxUsd` when unknown.

#### Why this step (action + reasoning)
1. **What** — the correctness fix across the two functions + flipping the two tests that currently assert the bug + adding regressions for the multi-round poison and the fail-closed cap.
2. **Why now** — this IS the bug; a regression test that reproduces the dishonest `$0`/complete-total must fail FIRST (RED), then the fix makes it green. It is the load-bearing honest-null surface.

#### Evidence
`usd-pricing.ts:48-54` (the `return 0` bug). `usd-budget-tracker.ts:51,63,67,88` (the sum, the cap, getTotalUsd). `D377-cost-status-closed-enum.md` + `compute-cost.ts:74-81` + `messages.ts:45-52` (the contract). Bug-asserting tests at `tests/usd-budget-tracker.test.ts` (`test_unknown_model_returns_zero` ~:35, `test_unknown_model_track_zero_usd_still_counts_tokens` ~:120).

#### Files to edit
```
packages/sdk-budget/src/usd-pricing.ts — return type number|undefined; unknown model → undefined; keep known-zero → 0; update the doc comment
packages/sdk-budget/src/usd-budget-tracker.ts — costKnown poison flag; track no longer adds 0 for unknown; getTotalUsd(): number|undefined; check() fail-closed on maxUsd+unknown
packages/sdk-budget/tests/usd-budget-tracker.test.ts — flip the 2 bug tests; add regressions
```

#### Deep file dependency analysis
- `usd-budget-tracker.ts` imports `computeUsdCost` from `./usd-pricing.js` — both change in this task. The `BudgetTracker` type from `@theokit/sdk` is unchanged (the `getTotalUsd` bonus method is on the returned object's extra type, not the SDK contract — its return type widens to `number|undefined`).

#### Pseudo-code / Signatures
```pseudocode
// usd-pricing.ts
computeUsdCost(pricing, model, type, tokens): number | undefined
  entry = pricing[model]; if (entry === undefined) return undefined   // was: return 0
  rate = type === "input" ? entry.inputPerMillionUsd : entry.outputPerMillionUsd
  if (!Number.isFinite(tokens) || tokens <= 0) return 0               // known model, zero tokens = honest $0
  return (tokens / 1_000_000) * rate

// usd-budget-tracker.ts
let totalUsd = 0; let costKnown = true
track(event):
  t = finite&>0 ? event.tokens : 0; if (t===0) return
  totalTokens += t
  cost = computeUsdCost(pricing, event.model, event.type, t)
  if (cost === undefined) { costKnown = false; return }   // poison; do NOT add 0
  if (costKnown) totalUsd += cost
getTotalUsd(): number | undefined  => costKnown ? totalUsd : undefined
check():
  if (maxUsd !== undefined) {
    if (!costKnown) return { allowed:false, reason:"cost_limit", detail:"cost unknown — cannot verify maxUsd" }
    if (totalUsd >= maxUsd) return { allowed:false, reason:"cost_limit", detail:... }
  }
  if (maxTokens !== undefined && totalTokens >= maxTokens) return { allowed:false, reason:"token_limit", detail:... }
  return { allowed:true }
```

#### TDD
```
RED: test_unknown_model_returns_undefined() — computeUsdCost(BUILTIN_PRICING,"nonexistent/model","input",1_000_000) === undefined (flips the old test_unknown_model_returns_zero)
RED: test_known_model_zero_tokens_is_zero() — computeUsdCost(BUILTIN_PRICING,"openai/gpt-4o-mini","input",0) === 0 (known-zero stays honest $0)
RED: test_known_model_cost_math_unchanged() — computeUsdCost(...,"openai/gpt-4o-mini","input",1_000_000) ≈ 0.15 (no regression)
RED: test_unknown_round_poisons_total() — track known then unknown → getTotalUsd() === undefined; getTotal().tokens === sum of both (flips test_unknown_model_track_zero_usd_still_counts_tokens)
RED: test_poison_is_sticky() — track unknown then known → getTotalUsd() === undefined (later known round does not resurrect)
RED: test_known_only_sums_number() — two known rounds → getTotalUsd() is a number ≈ expected sum
RED: test_check_fail_closed_on_unknown_with_maxUsd() — maxUsd set + an unknown round → check().allowed === false, reason === "cost_limit"
RED: test_check_allows_known_under_maxUsd() — maxUsd set + known rounds under cap → check().allowed === true
RED: test_token_cap_unaffected_by_unknown_cost() — maxTokens set, no maxUsd, unknown round over token cap → check().reason === "token_limit"
RED: test_check_unknown_cost_precedes_token_limit() — maxUsd AND maxTokens set, unknown round over both → check().reason === "cost_limit" (cost check runs first; documented precedence, edge EC-1)
GREEN: apply the fix to usd-pricing.ts + usd-budget-tracker.ts
REFACTOR: Biome complexity ≤ 10
VERIFY: pnpm --filter @theokit/sdk-budget exec vitest run tests/usd-budget-tracker.test.ts
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk-budget exec vitest run tests/usd-budget-tracker.test.ts` reports all tests passed (0 failed)
- [ ] `test_unknown_model_returns_undefined` passes (D1 honest-null)
- [ ] `test_unknown_round_poisons_total` + `test_poison_is_sticky` pass (D2 poison)
- [ ] `test_check_fail_closed_on_unknown_with_maxUsd` passes (D3 fail-closed)
- [ ] `test_known_model_zero_tokens_is_zero` + `test_known_only_sums_number` pass (no regression on the known path)
- [ ] `pnpm --filter @theokit/sdk-budget exec biome check packages/sdk-budget/src/usd-pricing.ts packages/sdk-budget/src/usd-budget-tracker.ts` reports 0 errors

#### DoD
- [ ] those tests green; `pnpm --filter @theokit/sdk-budget typecheck` exits 0

---

## Phase 2: Record the change

### T2.1 — Changeset + CHANGELOG (root + package)

#### Objective
Add a changeset + a root CHANGELOG `[Unreleased] § Fixed` entry + a `@theokit/sdk-budget` package CHANGELOG entry documenting the honest-null type change.

#### Why this step (action + reasoning)
1. **What** — record the fix + the `number → number | undefined` return-type change for consumers.
2. **Why now** — Unbreakable Rule 6 (every change updates the changelog); the type-surface change must be visible to consumers reading `getTotalUsd()`/`computeUsdCost`.

#### Evidence
`packages/sdk-budget/CHANGELOG.md` (`[Unreleased]`); root `CHANGELOG.md` (`[Unreleased] § Fixed`); `.changeset/` convention (per prior M3 changesets).

#### Files to edit
```
.changeset/m1-usage-honest-null.md — NEW (@theokit/sdk-budget: minor — return-type change on a 0.x package)
CHANGELOG.md (root) — [Unreleased] § Fixed entry
packages/sdk-budget/CHANGELOG.md — [Unreleased] § Fixed entry
```

#### Deep file dependency analysis
- Documentation-only; no code dependency. The changeset is `minor` for `@theokit/sdk-budget` (a public return-type change on a pre-1.0 package).

#### TDD
```
(doc-only task — no unit test; verified by oracle greps)
GREEN: add changeset + both CHANGELOG entries
VERIFY: ls .changeset/m1-usage-honest-null.md && grep -c "honest-null\|getTotalUsd\|computeUsdCost" CHANGELOG.md packages/sdk-budget/CHANGELOG.md
```

#### Acceptance Criteria
- [ ] `ls .changeset/m1-usage-honest-null.md` exists
- [ ] `grep -c "honest-null\|undefined\|computeUsdCost" CHANGELOG.md` returns ≥ 1 (root § Fixed)
- [ ] `grep -c "honest-null\|undefined\|getTotalUsd" packages/sdk-budget/CHANGELOG.md` returns ≥ 1

#### DoD
- [ ] changeset + both CHANGELOG entries present; `pnpm --filter @theokit/sdk-budget build` succeeds

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | `return 0` for unknown model (M1-6) | T1.1 | `computeUsdCost` → `undefined` (D1) |
| 2 | unknown poisons the sum, never $0 | T1.1 | tracker `costKnown` poison → `getTotalUsd()` undefined (D2) |
| 3 | tokens still counted | T1.1 | `totalTokens += t` before the cost branch (D2) |
| 4 | maxUsd honest under unknown | T1.1 | `check()` fail-closed on maxUsd+unknown (D3) |
| 5 | known path unchanged | T1.1 | known-model math + known-zero → 0 (D1) |
| 6 | bug-asserting tests flipped | T1.1 | the 2 old tests rewritten to expect undefined |
| 7 | zero new deps | T1.1 | pure edit (Rule 9) |
| 8 | Document the type change | T2.1 | changeset + root + package CHANGELOG |

**Coverage: 8/8 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm --filter @theokit/sdk-budget exec vitest run` green
- [ ] Zero type errors — `pnpm --filter @theokit/sdk-budget typecheck`
- [ ] Zero lint warnings — `pnpm --filter @theokit/sdk-budget exec biome check`
- [ ] Dead-code gate — `pnpm quality:dead` (knip) exits 0
- [ ] Build clean — `pnpm --filter @theokit/sdk-budget build`
- [ ] File-size budget respected (both files ≤ 400 LoC)
- [ ] CHANGELOG.md updated under `[Unreleased]` + changeset added (Unbreakable Rule 6)
- [ ] Plan-specific: unknown model → undefined; unknown round poisons getTotalUsd() to undefined (sticky); tokens still counted; maxUsd fails closed on unknown; known path unchanged; zero new deps
- [ ] Plan archived after `/review` READY_TO_MERGE + PR merge

## Dependencies

M1-6 introduces ZERO new dependencies — a pure correctness edit to two existing functions (Rule 9 / KISS).

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@theokit/sdk` (`BudgetTracker`/`BudgetUsageEvent`/`BudgetCheck`/`BudgetTotal`) | workspace | npm/TS | the tracker contract (existing peer dep) |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | — | — | n/a — a 4-line correctness edit needs no library. | n/a |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Failure scenarios

After the fix, `computeUsdCost` returns `undefined` (no throw) for an unknown model; the tracker's `track`/`check`/`getTotalUsd` remain sync + non-throwing (the contract). The only behavior changes are intentional: a dishonest `$0`/complete total becomes an honest `undefined`, and a `maxUsd` cap fails closed on unknown cost. No new runtime failure mode is introduced.

## Final Phase: Integration Validation (MANDATORY)

### Execution
```
pnpm --filter @theokit/sdk-budget exec vitest run tests/usd-budget-tracker.test.ts
pnpm --filter @theokit/sdk-budget exec vitest run        # full sdk-budget suite — no regression
pnpm --filter @theokit/sdk-budget typecheck
pnpm --filter @theokit/sdk-budget exec biome check
pnpm quality:dead
pnpm --filter @theokit/sdk-budget build
```

### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk-budget exec vitest run` exits 0 with 0 failed tests (full suite, no regression)
- [ ] `pnpm --filter @theokit/sdk-budget typecheck` exits 0 (0 type errors) and `pnpm --filter @theokit/sdk-budget exec biome check` reports 0 warnings
- [ ] `pnpm quality:dead` exits 0
- [ ] `pnpm --filter @theokit/sdk-budget build` succeeds (dist emitted)
- [ ] Runtime-metric proof — N/A (pure cost-accounting fix; observable via `getTotalUsd() === undefined` on an unknown round)

### If Validation Fails
1. Identify plan-caused vs pre-existing failures. 2. Fix all plan-caused. 3. Re-run. 4. Log pre-existing in the PR.
