# Review: M1 — Reliable agent harness (iteration budget + truncation signal)

> Cycle: REVIEW. Plan: `m1-reliable-harness`. Branch: `develop`. Diff range: `67698b4..HEAD`. Date: 2026-06-20.

## Verdict: READY_TO_MERGE

No surviving BLOCKER/HIGH. The one substantive review finding (a consistency gap) was fixed in this cycle. Phases 1-2 are complete; Phase 3 (`runToCompletion`) is deferred per Q2 (out of this cycle's scope by design).

## What shipped (commits `efe183e`, `e236c00`, `ed8c67d`, `bw01w9tkt`/consistency fix)

- **M1-1:** the agent loop calls `budgetTracker.nextIteration?.()` once per turn; `nextIteration?()` is now an optional `BudgetTracker` member. `createCounterBudgetTracker({ maxIterations: N })` actually halts after N (it was dead — nothing called it).
- **M1-2 knob:** `SendOptions.maxIterations` public per-send ceiling, validated at the boundary (positive integer or `ConfigurationError`), mapped through `buildLoopInputs`.
- **M1-2 truncation signal:** `RunResult.stoppedAtIterationLimit` threaded `LoopContext → AgentLoopOutput → FixtureScript → RunResult` (mirroring the usage/cost path). Set both when the legacy `IterationBudget` exhausts mid-tool-work AND when a pluggable tracker denies with `reason: "iteration_limit"` (consistency fix).

## Validation gates (all green)

| Gate | Result |
|---|---|
| Full `@theokit/sdk` suite | **2666 passed, 35 skipped, 0 failed** (385 files) — the real loop is exercised across the suite; no regression |
| typecheck | clean (the 7-file threading type-checks end-to-end) |
| biome | clean (extracted `applyScriptMetrics` to keep `buildResult` under the cognitive-complexity cap) |
| `pnpm quality:dead` | exit 0 — zero dead exports for the new surfaces |
| plan-confidence | SHIPPABLE_WITH_CAVEATS (88.4) |

## Adjudicated review findings

| Finding | Severity claimed | Adjudication |
|---|---|---|
| Truncation flag not set when the pluggable tracker denies at the loop top (M1-1 iteration_limit) | claimed BLOCKER | **Downgraded to MEDIUM, then FIXED.** Not a broken behavior: the tracker-deny path already surfaces `status: error` + `error.code: iteration_limit` (non-silent). The flag's ADR-M1-3 purpose is the *silent* finished-as-if-done case (legacy `IterationBudget`/`SendOptions.maxIterations`), which worked. But the consistency point is valid — a consumer using `createCounterBudgetTracker({maxIterations})` should see the same signal. Fixed: the gate branch now also sets `stoppedAtIterationLimit` on `reason === "iteration_limit"`. |
| Mirror tests don't drive the real loop | MEDIUM | **Accepted as the repo convention.** The repo cannot unit-drive the loop without a stubbed LLM (documented in `agent-loop-budget-tracker-wiring.test.ts`); the full 2666-test suite exercises the real loop in fixture/real paths. Mirror tests pin the branch logic; this is the established bar. |
| `SendOptions.maxIterations` validation misses `Infinity` | claimed HIGH | **Refuted by the agent's own analysis** — `Number.isInteger(Infinity) === false`, so it is rejected. 0/-1/1.5/NaN/Infinity all caught. No issue. |
| `nextIteration?()` optional chaining | INFO | Correct — undefined tracker / tracker-without-method both no-op. |
| Fixture path never sets the flag | MEDIUM | **By design** — fixtures replay pre-recorded scripts, not the real loop. The field is present for the real-loop path; the threading is correct. |

## Backward compatibility

All three additions are optional + additive: `BudgetTracker.nextIteration?()`, `SendOptions.maxIterations?`, `RunResult.stoppedAtIterationLimit?`. No existing export or signature changed. Existing custom `BudgetTracker` implementers compile unchanged (typecheck-verified). Default loop cap stays 8 when nothing is supplied.

## Hard gates (cycle-review BLOCKER checks)

- Failing tests on branch: none (2666/2666 green).
- New secrets committed: none.
- Direct commit to `main`: none (all on `develop`).
- `Co-Authored-By` trailer: none.
- CHANGELOG updated despite source changes: yes (root `[Unreleased]` Added/Fixed + changeset `m1-reliable-harness`).

## Q2 resolution (Phase 3 — `runToCompletion`)

**Deferred to a follow-up cycle.** The continuation driver is an L that consumes the now-shipped foundation (`maxIterations` knob + `stoppedAtIterationLimit` signal). Phases 1-2 are independently complete and shippable; nothing is left in a broken state. The driver's design is mapped in the discovery (reference `theocode/server/lib/agent-loop.ts`).

## Next step

`READY_TO_MERGE`. Release via changesets (`@theokit/sdk` minor — `m1-reliable-harness` changeset present). Human-gated: develop→main PR + `changeset publish`.
