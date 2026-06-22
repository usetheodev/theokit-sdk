# Review: m1-usage-honest-null

**Date:** 2026-06-21
**Reviewers (spawned agents):** 2 — behavior+test-auditor, cross-validation+architecture (general-purpose, opus-class)
**Findings:** 0 BLOCKER, 0 HIGH, 1 LOW (advisory), INFO
**Verdict:** READY_TO_MERGE

> Per-agent finding files: `.claude/agents/review-m1-usage-honest-null-2026-06-21/findings/*.md`.

## Scope reviewed

Commits `86f89b2` (T1.1 fix + flipped/added tests) + `1706517` (T2.1 changeset + root/package CHANGELOG) + `87378e2` (code-quality audit), on `develop` vs `main`. Files: `packages/sdk-budget/src/usd-pricing.ts`, `usd-budget-tracker.ts`, `tests/usd-budget-tracker.test.ts`, root `CHANGELOG.md`, `packages/sdk-budget/CHANGELOG.md`, `.changeset/m1-usage-honest-null.md`.

## BLOCKER / HIGH findings

_None._ Both reviewers independently reached 0 BLOCKER, 0 HIGH. The fix is correct, complete, and contract-aligned:
- `computeUsdCost`: unknown model → `undefined`; known model + zero/invalid tokens → real `0` (the entry lookup runs before the token guard, so an unknown model can never reach `return 0`); known + valid → correct math. This undefined-vs-0 distinction is the crux of honest-null and is exactly right.
- tracker poisoning is sticky (`costKnown` never reset; a later known round is gated by `if (costKnown)`); tokens always counted; `getTotalUsd()` returns `undefined` when poisoned. No NaN path (the `cost === undefined` guard precedes `totalUsd +=`).
- `check()` fails closed on `maxUsd`+unknown (`cost_limit`, detail says "cost unknown"); cost precedence over token preserved (EC-1).

## LOW findings (advisory — no action this slice)

- **RED test not committed separately before GREEN** (cross-validation): the src fix + the flipped/added tests landed in one commit (`86f89b2`), so the git history doesn't show a discrete RED→GREEN ordering. The tests genuinely reproduce the bug (verified: 6 failed against the old code before the fix) and the 2 bug-asserting tests were genuinely FLIPPED (not deleted) — the behavioral outcome and coverage are correct. Advisory for future bug-fix slices to commit the failing RED test first.

## INFO confirmations

- ADRs D1/D2/D3 honored in code; Coverage Matrix 8/8 genuine (each row implemented + tested), incl. EC-1 precedence.
- Architecture: `evaluateCostCap`/`evaluateTokenCap` extraction is clean SRP, complexity ≤ 10; the `check()` refactor (`evaluateCostCap ?? evaluateTokenCap ?? {allowed:true}`) is behavior-preserving vs the original (same operators, detail strings, precedence, fallthrough) — the only addition is the D3 fail-closed branch; DIP intact (type-only `@theokit/sdk` imports); zero new deps.
- Honest-null aligned with `D377-cost-status-closed-enum.md` + the SDK's `compute-cost.ts` (unknown → `amountUsd: undefined`; included → `0` — unknown ≠ $0).
- Pre-existing tests not broken (fresh/invalid-only tracker → `costKnown=true` → `getTotalUsd()===0`, which is honest: no unknown round happened). Regression tests non-vacuous — kill the still-add-0, removed-fail-closed, and reversed-precedence mutants.
- Type-change surface: `computeUsdCost`/`getTotalUsd()` now `number | undefined` — the only in-repo caller is the tracker (updated in the same task); no other consumer breaks (typecheck exit 0). changeset `@theokit/sdk-budget:minor` correct; root + package CHANGELOG both flag the type change for consumers. No docs.md change needed (per-package API, not in the `@theokit/sdk` contract).
- No scope creep: only the planned files changed; working tree clean.

## Quality gate re-validation

- `@theokit/sdk-budget` suite: 2 files / **42 passed, 0 failed** (+8 from M1-6: 6 honest-null/poison/fail-closed + 1 known-zero + the precedence case; 2 bug tests flipped in place).
- typecheck exit 0; Biome clean (complexity ≤ 10 after the cap-evaluator extraction); knip exit 0; build emits dist; code-quality PASS.

## Edge-case coverage

Plan EC-1 (cost_limit precedes token_limit under unknown) covered; EC-2/EC-3 documented (per-instance sticky poison; tokens always a number). Plus the review-relevant fresh/invalid-tracker honest-zero and known→unknown→known sticky transitions.

## Verdict rationale

0 BLOCKER, 0 HIGH from two independent reviewers. The fix delivers the roadmap intent exactly ("unknown poisons the sum, never $0; fix `usd-pricing.ts:50 return 0`") with mutation-resistant regression tests and full contract alignment; the single LOW (RED/GREEN co-commit) is advisory with no behavioral impact. Per `cycle-review.md § Verdicts`: **READY_TO_MERGE.** This is the last M1 item — M1 (Tema A) is now complete.

## Recommended next step

`/release` (a `@theokit/sdk-budget` minor — honest-null cost fix). Then M1 is fully shipped; the roadmap's next waves are M4 (skills/memória/projeto) and M6 (eval harness).
