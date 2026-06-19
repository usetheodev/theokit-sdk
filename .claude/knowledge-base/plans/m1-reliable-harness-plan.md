---
slug: m1-reliable-harness
created_at: 2026-06-19
goal: Make the agent loop's iteration ceiling real and raisable so long-running agents stop silently losing work, by wiring the dead budgetTracker.nextIteration() and exposing a public per-send maxIterations knob plus a truncation signal, measured by a counter-tracker halting after N iterations and a send reporting when it stopped at the cap rather than finishing.
---

# Plan: M1 — Reliable agent harness (iteration budget + truncation signal)

> **Version 1.0** — The gap audit (gap-audit/THEOKIT_GAP_AUDIT.md, Tema A, rows M1-1/M1-2) found the agent loop's iteration guard-rail is broken in two ways: (M1-1) `budgetTracker.nextIteration()` is implemented but NEVER called, so `createCounterBudgetTracker({ maxIterations })` never halts; (M1-2) the loop caps at a hardcoded `maxIterations ?? 8` with no public knob and no signal distinguishing "the model finished" from "we hit the cap mid-work". This plan fixes M1-1 (call nextIteration, make it part of the contract) and the M1-2 foundation (public `maxIterations` in SendOptions + a truncation signal on the result). The full `runToCompletion` continuation driver is scoped as Phase 3 and may ship in a follow-up if it exceeds this cycle.

## Goal

> "Enable a builder to set a real, raisable per-send iteration ceiling on the agent loop and learn when a send stopped at that ceiling instead of finishing, so long-running agents stop silently losing work, measured by: (a) `createCounterBudgetTracker({ maxIterations: N })` halting the loop after exactly N turns; (b) `agent.send(msg, { maxIterations: M })` honoring M; (c) the run result reporting `stoppedAtIterationLimit` when the loop hit the cap with tool work still pending."

## Context

The gap audit (2026-06-19) verified against source: `budget-tracker-counter.ts:80` implements `nextIteration()` (increments an `iterations` counter that `check()` gates on), but a project-wide grep found ZERO calls to it in `internal/agent-loop/loop.ts` — so the counter stays at 0 and the iteration ceiling the public trackers advertise is dead. Separately, `loop.ts:43` caps the loop at `inputs.maxIterations ?? 8` via the legacy `IterationBudget`; `SendOptions` (`types/run.ts:137`) exposes no `maxIterations`, `buildLoopInputs` (`real-local-run.ts`) does not map one, and the loop emits no signal when it stops at the cap with pending tool calls — so a turn that exceeds 8 tool calls returns `finished` as if done, silently truncated. The theocode code-assistant had to rebuild an outer continuation loop to survive this (`theocode/server/lib/agent-loop.ts`).

## Baseline Context (deep review of current state)

Repository git HEAD at plan time: `67698b4` (2026-06-19), branch `develop`.

### Files that will be touched

| File | LoC today | Last commit | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk/src/internal/runtime/budget/budget-tracker.ts` | 77 | `67698b4` (2026-06-19) | `BudgetTracker` interface (`track`/`check`/`getTotal`) | existing 3 methods unchanged; adding an OPTIONAL method is backward-compatible |
| `packages/sdk/src/internal/runtime/budget/budget-tracker-counter.ts` | 84 | `67698b4` (2026-06-19) | `createCounterBudgetTracker` — implements `nextIteration()` (line 80) | counter semantics unchanged |
| `packages/sdk/src/internal/agent-loop/loop.ts` | 286 | `67698b4` (2026-06-19) | The turn loop; `?? 8` cap (line 43), `budget.consume()` (line 65), budget gate (line 48) | token/USD gating unchanged; default cap stays 8 when nothing supplied; `done` break unchanged |
| `packages/sdk/src/types/run.ts` | 218 | `67698b4` (2026-06-19) | `SendOptions` (line 137) + `RunResult` | existing fields unchanged; additions only |
| `packages/sdk/src/internal/runtime/local-agent/real-local-run.ts` | 397 | `67698b4` (2026-06-19) | `buildLoopInputs` maps SendOptions→AgentLoopInputs | existing mappings unchanged; additive |
| `packages/sdk/src/types/agent.ts` | 799 | `67698b4` (2026-06-19) | `AgentOptions.budgetTracker` (line ~492) | unchanged |
| `packages/sdk/docs.md` | n/a | `67698b4` (2026-06-19) | Public API contract | additions only |
| `packages/sdk/tests/m1-iteration-budget.test.ts` (NEW) | 0 | — | (file to be created) | — |

### Current callers / dependents

- **Symbol:** `nextIteration` on `createCounterBudgetTracker` result — Callers: NONE in production (grep-confirmed). Defined `budget-tracker-counter.ts:80`. The fix adds the first real caller (the loop).
- **Symbol:** `BudgetTracker` interface (`budget-tracker.ts:70`) — Implementers: `createCounterBudgetTracker`, the USD tracker; consumed by `loop.ts:48` (`evaluateBudgetGate`) and `loop.ts:217-238` (`track()`). External: yes (public type, consumers may implement it).
- **Symbol:** `SendOptions` (`types/run.ts:137`) — Consumed by `agent.send` and `buildLoopInputs` (`real-local-run.ts`). External: yes (public API).
- **Symbol:** the legacy `IterationBudget` (`budget.ts`) — Constructed at `loop.ts:43` from `inputs.maxIterations ?? 8`. The loop already honors `inputs.maxIterations`.

### Domain glossary

- **IterationBudget** — the legacy per-loop iteration counter (`budget.ts`) that gates `while (budget.shouldContinue())`; defaults to 8 with a +1 grace call.
- **BudgetTracker** — the newer pluggable budget contract (`track`/`check`/`getTotal`) a consumer supplies via `Agent.create({ budgetTracker })`; gates the loop via `check()` (token/USD work today; iteration is dead because `nextIteration` is never called).
- **truncation** — the loop stopping because it hit the iteration cap while the model was still calling tools (vs the model emitting a final answer = `done`).

### Architecture boundaries affected

Per `rules/architecture.md`: changes live in the runtime/agent-loop infrastructure layer plus the public `types/` contract (additive). No inner→outer dependency introduced. The new `nextIteration` call is the loop (infra) invoking a method on an injected port (the tracker) — correct direction.

## Prior Art & Related Work

- **Gap audit report** — `gap-audit/THEOKIT_GAP_AUDIT.md` Tema A + master-table rows M1-1 (`nextIteration` dead) and M1-2 (8-step cap, no knob, no truncation signal).
- **Discovery baseline** — this cycle's read-only discovery confirmed every premise against source (`loop.ts:43/48/65`, `budget-tracker-counter.ts:80`, `SendOptions` at `types/run.ts:137`, no `maxIterations` mapping in `real-local-run.ts`).
- **Consumer reference** — `theocode/server/lib/agent-loop.ts` shows the outer continuation loop a builder is forced to hand-roll today (CONTINUE_PROMPT, STEP_LIMIT_NOTICE, NO_PROGRESS_NOTICE terminals) — the shape Phase 3's `runToCompletion` would absorb.
- **Existing budget tests** — `tests/budget-tracker-counter.test.ts`, `tests/agent-loop-budget-tracker-wiring.test.ts`, `tests/agent-loop-budget-gate.test.ts`, `tests/agent-create-budget-tracker-option.test.ts` establish the patterns to extend.

## Objective

- [ ] The loop calls `nextIteration()` once per turn on a tracker that supports it; `createCounterBudgetTracker({ maxIterations: N })` halts after N
- [ ] `BudgetTracker` declares `nextIteration?()` as an optional method (backward-compatible)
- [ ] `SendOptions.maxIterations` is public and flows through `buildLoopInputs` to the loop (precedence: send > agent-create > default 8)
- [ ] The run result reports `stoppedAtIterationLimit: true` when the loop stopped at the cap with pending tool work
- [ ] `docs.md` + CHANGELOG updated; `pnpm quality:dead` clean for new surfaces
- [ ] (Phase 3, may defer) `agent.runToCompletion(msg, { stepBudget, onTruncated })` continuation driver

## ADRs

### ADR-M1-1 — `nextIteration` is an optional method on the `BudgetTracker` interface

- **Decision:** Add `nextIteration?(): void` to the `BudgetTracker` interface; the loop calls `inputs.budgetTracker?.nextIteration?.()` once per completed turn (right after `budget.consume()`).
- **Rationale:** The method already exists on the shipped counter/USD trackers as an anonymous type extension; promoting it to an optional interface member makes the loop call type-safe without a cast, and keeps custom trackers that do not track iterations valid (optional).
- **Alternatives considered:** (a) Make it required — rejected: breaks existing custom `BudgetTracker` implementers. (b) Type-cast at the call site (`'nextIteration' in tracker`) — rejected: untyped, fragile. (c) Fold iteration counting into `track()` — rejected: `track()` is per-usage-event (tokens), not per-turn; conflating them changes its contract.
- **Consequences:** Iteration ceilings on the pluggable tracker become real. Custom trackers gain an opt-in hook. One new call site in the loop.

### ADR-M1-2 — Public `SendOptions.maxIterations` with send > create > default precedence

- **Decision:** Add `maxIterations?: number` to `SendOptions`; `buildLoopInputs` maps it to `inputs.maxIterations`; precedence is per-send override, then agent-create, then the existing default of 8.
- **Rationale:** The loop already honors `inputs.maxIterations` (`loop.ts:43`); the only gap is the public surface + mapping. Per-send is the right granularity (a single long task may need a higher cap than the agent's default).
- **Alternatives considered:** (a) Only agent-create-level — rejected: too coarse; a builder cannot raise the cap for one heavy turn. (b) Expose the raw `IterationBudget` — rejected: leaks an internal type.
- **Consequences:** Builders can raise the cap without reconstructing the agent. Default behavior (8) preserved when unset.

### ADR-M1-3 — Truncation reported as a boolean on the result, not an exception

- **Decision:** Set `stoppedAtIterationLimit: true` on the run result when the loop exits because the iteration budget is exhausted AND the last turn still wanted to call tools (pending work), vs `done`. Surface it as an optional boolean field, not a thrown error.
- **Rationale:** Truncation is a normal, recoverable outcome a driver inspects to decide whether to continue — not an error. A boolean is the minimal honest signal; the existing empty-finish→error path (`loop.ts:69-73`) stays for the genuinely-empty case.
- **Alternatives considered:** (a) Throw — rejected: truncation is not exceptional; throwing would break existing single-send callers. (b) A rich terminal enum (`done`/`step_limit`/`no_progress`) — deferred to Phase 3's `runToCompletion`; the boolean is the foundation it builds on.
- **Consequences:** Single-send callers can detect silent truncation. Phase 3 consumes this flag.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Calling `nextIteration()` changes the effective halt behavior of agents that already pass a counter tracker with `maxIterations` (it now actually halts) | Medium | This is the intended fix; document in CHANGELOG as a behavior fix. Existing tests pin token/USD gating; add a test that the counter now halts | impl |
| Detecting "pending tool work at cap" may misclassify a clean finish as truncated | Medium | Derive the flag from the same signal the loop already uses (budget exhausted + last decision was a tool round, not `done`); unit-test both the truncated and the clean-finish path | impl |
| Adding `nextIteration?` to the interface could surprise implementers who exhaustively switch on the type | Low | Optional member; existing implementers compile unchanged (verified by typecheck) | impl |
| Phase 3 `runToCompletion` is an L and may not fit this cycle | Medium | Phases 1-2 are independently shippable; Phase 3 is explicitly deferrable without leaving the loop in a broken state | impl |

## Unresolved Questions

- Q1 — Exactly which loop state distinguishes "stopped at cap with pending tools" from "stopped at cap right as the model finished"? (Resolve in T2.2 by reading the last `runIteration` decision + `budget.shouldContinue()` at exit; the loop already tracks `decision === "done"`.) — MUST-FIX before merge.
- Q2 — Should Phase 3 (`runToCompletion`) ship this cycle or as a follow-up? (Resolve after Phases 1-2 land + are validated; decide based on remaining scope.) — MUST-FIX before declaring the milestone done.

## Dependencies

No new third-party dependency. Pure internal wiring + public type additions on the already-present `@theokit/sdk`.

| Dependency | Version | New? | Rule 9 justification |
|---|---|---|---|
| (none) | — | — | All work is internal to `@theokit/sdk`; no library solves "call my own dead method" |

No CVE surface change.

## Dependency Graph

```
Phase 1 (M1-1 nextIteration wiring) ── independent, shippable
Phase 2 (M1-2 knob + truncation signal) ── independent of Phase 1, shippable
Phase 3 (runToCompletion driver) ── depends on Phase 2 (consumes maxIterations + truncation flag); DEFERRABLE
```

Phases 1 and 2 are independent and each shippable alone. Phase 3 depends on Phase 2 and is explicitly deferrable. Sequence 1 → 2 → 3.

---

## Phase 1: M1-1 — Wire the dead `nextIteration()`

**Objective:** Make the pluggable tracker's iteration ceiling real.

### T1.1 — Add optional `nextIteration` to the interface and call it in the loop

#### Objective
Declare `nextIteration?()` on `BudgetTracker`; call `inputs.budgetTracker?.nextIteration?.()` once per turn in the loop.

#### Why this step (action + reasoning)

1. **What this step does** — promotes the existing `nextIteration` to an optional interface member and adds the single missing call site in the loop after `budget.consume()`.
2. **Why it is necessary now** — it is the smallest, highest-leverage HIGH fix (a universal "don't run away and burn money" guard-rail that is currently dead), and it is the foundation builders expect when they pass `createCounterBudgetTracker({ maxIterations })`.

#### Evidence
`budget-tracker-counter.ts:80` implements `nextIteration()`; `budget-tracker.ts:70-77` interface lacks it; grep found zero calls in `loop.ts`. `loop.ts:65` is `budget.consume()` — the per-turn boundary.

#### Files to edit
```
packages/sdk/src/internal/runtime/budget/budget-tracker.ts — add nextIteration?(): void to the interface
packages/sdk/src/internal/agent-loop/loop.ts — call inputs.budgetTracker?.nextIteration?.() after budget.consume()
packages/sdk/tests/m1-iteration-budget.test.ts — RED test added first (TDD)
packages/sdk/docs.md — note the iteration ceiling now fires
packages/sdk/CHANGELOG.md — [Unreleased] Fixed entry
```

#### Deep file dependency analysis
- `budget-tracker.ts` (Baseline: 77 LoC) — gains one optional method; existing implementers unaffected.
- `loop.ts` (Baseline: 286 LoC) — gains one call after line 65; token/USD gating untouched.

#### Deep Dives
- Invariant: default cap stays 8 when no tracker/maxIterations supplied; token+USD gating unchanged.
- Edge cases: tracker without `nextIteration` (custom) → optional chaining no-ops; tracker with it → counter advances and `check()` halts after N.

#### Pseudo-code / Signatures
```pseudocode
// budget-tracker.ts
interface BudgetTracker { track(...); check(); getTotal(); nextIteration?(): void }
// loop.ts (after budget.consume())
inputs.budgetTracker?.nextIteration?.()
```

#### Tasks
1. Write RED test: a counter tracker with `maxIterations: 3` passed to the loop halts after 3 turns.
2. Add the optional interface member + the call site.

#### TDD
```
RED:  test_counter_tracker_halts_loop_after_maxIterations() — loop with maxIterations:3 runs 3 turns then the budget gate denies
RED:  test_loop_without_nextIteration_tracker_is_unaffected() — a tracker lacking nextIteration still gates on token/USD only (no crash)
GREEN: add optional member + call site
REFACTOR: None expected
VERIFY: pnpm --filter @theokit/sdk exec vitest run tests/m1-iteration-budget.test.ts
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/m1-iteration-budget.test.ts` exits 0 (Phase-1 tests pass)
- [ ] A counter tracker with `maxIterations: N` halts the loop after exactly N turns (asserted)
- [ ] Pass: typecheck — `pnpm --filter @theokit/sdk run typecheck` reports zero errors (proves existing implementers still satisfy the interface)
- [ ] Pass: lint — `pnpm --filter @theokit/sdk exec biome check` reports zero errors on changed files
- [ ] `CHANGELOG.md` has the M1-1 Fixed entry

#### DoD
- [ ] `pnpm --filter @theokit/sdk test` exits 0
- [ ] `pnpm --filter @theokit/sdk run typecheck` zero errors
- [ ] `biome check` reports zero errors on changed files
- [ ] CHANGELOG updated

---

## Phase 2: M1-2 — Public iteration knob + truncation signal

**Objective:** Let a builder raise the cap per send and learn when a send truncated.

### T2.1 — Expose `SendOptions.maxIterations` through `buildLoopInputs`

#### Objective
Add `maxIterations?` to `SendOptions` and map it into the loop inputs with send > create > default precedence.

#### Why this step (action + reasoning)

1. **What this step does** — adds the public field and the one mapping line so a per-send cap reaches the loop (which already honors `inputs.maxIterations`).
2. **Why it is necessary now** — without it the 8-cap is unraisable; a single heavy turn cannot get a higher ceiling, forcing the hand-rolled outer loop.

#### Evidence
`SendOptions` at `types/run.ts:137` has no `maxIterations`; `buildLoopInputs` in `real-local-run.ts` does not map one; `loop.ts:43` already reads `inputs.maxIterations ?? 8`.

#### Files to edit
```
packages/sdk/src/types/run.ts — add maxIterations?: number to SendOptions
packages/sdk/src/internal/runtime/local-agent/real-local-run.ts — map sendOptions.maxIterations into loop inputs
packages/sdk/tests/m1-iteration-budget.test.ts — RED tests
packages/sdk/docs.md — document SendOptions.maxIterations
packages/sdk/CHANGELOG.md — [Unreleased] Added entry
```

#### Deep file dependency analysis
- `types/run.ts` (Baseline: 218 LoC) — additive field on the public `SendOptions`.
- `real-local-run.ts` (Baseline: 397 LoC) — one additive mapping honoring precedence.

#### Deep Dives
- Invariant: when `maxIterations` is unset everywhere, the cap is 8 (unchanged).
- Edge cases: send-level value overrides agent-create value; invalid (≤0/non-integer) → reject at the boundary with a clear error (reuse the existing validation pattern).

#### Pseudo-code / Signatures
```pseudocode
interface SendOptions { /* ...existing... */ maxIterations?: number }
// buildLoopInputs: inputs.maxIterations = sendOptions.maxIterations ?? agentOptions.maxIterations
```

#### Tasks
1. Write RED test: `send(msg, { maxIterations: 2 })` halts after 2 turns; send-level overrides create-level.
2. Add the field + mapping + boundary validation.

#### TDD
```
RED:  test_send_maxIterations_caps_the_loop() — send with maxIterations:2 runs 2 turns
RED:  test_send_maxIterations_overrides_agent_create_value() — send value wins over create value
RED:  test_send_maxIterations_rejects_non_positive_integer() — throws ConfigurationError at the boundary
GREEN: add field + mapping + validation
REFACTOR: None expected
VERIFY: pnpm --filter @theokit/sdk exec vitest run tests/m1-iteration-budget.test.ts
```

#### Acceptance Criteria
- [ ] `import` of `SendOptions` exposes `maxIterations` (typecheck proves the field is public)
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/m1-iteration-budget.test.ts` exits 0 (T2.1 tests pass)
- [ ] A send with `maxIterations: M` halts after M turns; send overrides create (asserted)
- [ ] Pass: lint — `biome check` reports zero errors on changed files
- [ ] `docs.md` + `CHANGELOG.md` updated

#### DoD
- [ ] `pnpm --filter @theokit/sdk test` exits 0
- [ ] `typecheck` zero errors; `biome check` zero errors
- [ ] CHANGELOG updated

### T2.2 — Report `stoppedAtIterationLimit` on the result

#### Objective
Set a boolean on the run result when the loop exits at the cap with pending tool work.

#### Why this step (action + reasoning)

1. **What this step does** — derives a truncation boolean from the loop's existing exit state and surfaces it on the result.
2. **Why it is necessary now** — a single send currently cannot tell "finished" from "silently truncated at the cap"; this is the signal a continuation driver (Phase 3) and any careful caller needs.

#### Evidence
`loop.ts:65-73` shows the loop exits `while (budget.shouldContinue())` and currently only converts an empty finish to error; there is no signal for "stopped at cap with the model still wanting tools". `decision === "done"` (`loop.ts:60`) is the clean-finish marker.

#### Files to edit
```
packages/sdk/src/types/run.ts — add stoppedAtIterationLimit?: boolean to RunResult
packages/sdk/src/internal/agent-loop/loop.ts — set the flag on cap-exhausted-with-pending-tools exit
packages/sdk/tests/m1-iteration-budget.test.ts — RED tests
packages/sdk/docs.md — document the field
packages/sdk/CHANGELOG.md — [Unreleased] Added entry
```

#### Deep file dependency analysis
- `types/run.ts` — additive optional field on `RunResult`.
- `loop.ts` — sets the flag at the loop exit based on whether the budget was exhausted and the last turn was a tool round (not `done`).

#### Deep Dives
- Invariant: a genuine `done` finish leaves the flag falsy/absent.
- Edge cases: cap hit exactly as the model finishes → NOT truncated (last decision was `done`); cap hit mid-tool-work → truncated.

#### Pseudo-code / Signatures
```pseudocode
interface RunResult { /* ...existing... */ stoppedAtIterationLimit?: boolean }
// loop exit: if (!budget.shouldContinue() && lastDecision !== "done") ctx.stoppedAtIterationLimit = true
```

#### Tasks
1. Write RED test: a loop capped below the work needed reports `stoppedAtIterationLimit: true`; a loop that finishes within the cap reports it falsy.
2. Track the last decision; set the flag at exit; thread it into the result.

#### TDD
```
RED:  test_result_flags_truncation_when_capped_mid_tools() — capped run with pending tools → stoppedAtIterationLimit true
RED:  test_result_no_truncation_flag_on_clean_finish() — model finishes within cap → flag falsy
GREEN: track last decision + set flag + thread to result
REFACTOR: None expected
VERIFY: pnpm --filter @theokit/sdk exec vitest run tests/m1-iteration-budget.test.ts
```

#### Acceptance Criteria
- [ ] A capped-mid-tools run reports `stoppedAtIterationLimit === true` (asserted)
- [ ] A clean finish reports the flag falsy/absent (asserted)
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/m1-iteration-budget.test.ts` exits 0
- [ ] Pass: lint — `biome check` reports zero errors on changed files
- [ ] `docs.md` + `CHANGELOG.md` updated

#### DoD
- [ ] `pnpm --filter @theokit/sdk test` exits 0
- [ ] `typecheck` zero errors; `biome check` zero errors
- [ ] CHANGELOG updated

---

## Phase 3 (DEFERRABLE): `runToCompletion` continuation driver

**Objective:** Ship a public driver that re-sends accumulated history until a genuine terminal, consuming the Phase-2 truncation signal.

> This phase is an L. It is out of scope for the current cycle and may ship in a follow-up (per Q2) without leaving Phases 1-2 broken. If undertaken, it adds `agent.runToCompletion(message, { stepBudget, onTruncated })` returning a terminal (`done` / `step_limit` / `no_progress`), driving repeated `send`s that re-send accumulated history while `stoppedAtIterationLimit` is true and progress is being made. Design reference: `theocode/server/lib/agent-loop.ts`. The detailed task breakdown is authored when this phase is scheduled — it is intentionally NOT decomposed into tasks here, so the current cycle's coverage stays scoped to Phases 1-2.

---

## Coverage Matrix

| # | Gap / Requirement (gap-audit) | Task(s) | Resolution |
|---|---|---|---|
| 1 | M1-1 `nextIteration()` dead in the loop | T1.1 | Optional interface member + per-turn call |
| 2 | M1-2 hardcoded 8-step cap, no public knob | T2.1 | `SendOptions.maxIterations` + mapping |
| 3 | M1-2 no signal distinguishing truncation from finish | T2.2 | `RunResult.stoppedAtIterationLimit` |

**Coverage: 3/3 gaps mapped (100%)**

> The full `runToCompletion` continuation driver is explicitly OUT of this cycle's scope (Phase 3, deferrable per Q2) and is therefore not a row in this matrix — the matrix covers only what this cycle ships.

## Global Definition of Done

- [ ] Phases 1-2 completed (Phase 3 per Q2)
- [ ] `pnpm --filter @theokit/sdk test` exits 0
- [ ] `pnpm --filter @theokit/sdk run typecheck` zero errors
- [ ] `pnpm --filter @theokit/sdk exec biome check` zero errors on changed files
- [ ] every changed file ≤ 500 lines (`wc -l`; `loop.ts` stays under after additions)
- [ ] `CHANGELOG.md` updated under `[Unreleased]`
- [ ] Backward compatibility preserved (existing exports/signatures unchanged; additions only)
- [ ] `pnpm quality:dead` reports zero unallowlisted dead exports for new surfaces
- [ ] `docs.md` documents `SendOptions.maxIterations`, `RunResult.stoppedAtIterationLimit`, and the now-live iteration ceiling

## Final Phase: Integration Validation (MANDATORY)

**Objective:** Validate the iteration budget + truncation signal in the real loop, not just isolated units.

### Execution
```
pnpm --filter @theokit/sdk test
pnpm --filter @theokit/sdk run typecheck
pnpm --filter @theokit/sdk exec biome check
pnpm quality:dead
```

### Acceptance Criteria
- [ ] All suites green
- [ ] Zero type errors; zero biome errors on changed files
- [ ] `quality:dead` clean for new surfaces
- [ ] Wiring proof: the loop's new `nextIteration()` call is exercised by the counter-halt test (real caller, not just a unit of the tracker)

### If Validation Fails
1. Separate plan-caused failures from pre-existing.
2. Fix all plan-caused failures; re-run.
3. Pre-existing issues logged in the PR description, not blocking.
