---
slug: m1-run-to-completion
created_at: 2026-06-20
goal: Ship agent.runToCompletion(message, options) so a long-running agent finishes work that exceeds one send's iteration cap by re-sending until a genuine terminal, measured by a fake-driven core returning done/step_limit/no_progress with aggregated usage across rounds.
---

# Plan: M1 Phase 3 — `runToCompletion` continuation driver

> **Version 1.0** — The gap audit (Tema A / M1-2) found that a turn exceeding the agent loop's iteration cap returns `finished` as if done, silently truncated — forcing every builder to hand-roll an outer continuation loop (proven by `theocode/server/lib/agent-loop.ts`). M1-1/M1-2 shipped the foundation (`SendOptions.maxIterations`, `RunResult.stoppedAtIterationLimit`). This plan ships the public driver `agent.runToCompletion(message, options)` that consumes that signal: it re-sends a continuation prompt until the model genuinely finishes (`done`), the round budget is exhausted (`step_limit`), or two rounds make no progress (`no_progress`). Discovery confirmed the agent is STATEFUL (session storage preserves history across sends), so the driver only re-sends a continuation prompt — `buildReplayHistory` (M1-3) is NOT needed here and stays an independent item.

## Goal

> "Enable a builder to call `agent.runToCompletion(message, options)` and have the agent finish work that exceeds a single send's iteration ceiling, so long-running tasks complete instead of silently truncating, measured by: the driver core returning `terminal: 'done'` when the agent finishes, `'step_limit'` when `maxRounds` is exhausted while still truncating, and `'no_progress'` after two empty rounds — each asserted against a deterministic fake `send`, with usage aggregated across rounds."

## Context

Discovery (this cycle, read-only) verified against source: the SDKAgent instance method `send()` (`types/agent.ts:582`) is stateful — `local-agent-send.ts` reads prior messages via `getSessionMessages` and appends each turn, so re-sending a short continuation prompt resumes the same conversation (no history reconstruction needed). `run.wait()` (`types/run.ts:227`) returns `RunResult` which now carries `stoppedAtIterationLimit` (shipped 2.2.0). The existing `runUntilImpl` (`internal/runtime/lifecycle/run-until.ts:27`) is the exact structural template: an injectable impl in `lifecycle/` that loops `agent.send(prompt).wait()`, handles an `AbortSignal`, and caps turns — `runToCompletion` is a simpler sibling (no judge, no event stream). The reference outer loop the SDK must absorb is `theocode/server/lib/agent-loop.ts` (CONTINUE_PROMPT, STEP_LIMIT/NO_PROGRESS terminals, per-round signal analysis).

## Baseline Context (deep review of current state)

Repository git HEAD at plan time: `9ba6b49` (2026-06-20), branch `develop`. `@theokit/sdk@2.2.0` published.

### Files that will be touched

| File | LoC today | Last commit | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk/src/internal/runtime/lifecycle/run-to-completion.ts` (NEW) | 0 | — | (driver impl + pure helpers) | — |
| `packages/sdk/src/internal/runtime/local-agent/local-agent-runtime-extensions.ts` | 94 | `9ba6b49` (2026-06-20) | Thin delegates for `runUntil`/`fork` (lazy-import impl) | existing delegates unchanged; add one sibling |
| `packages/sdk/src/internal/runtime/local-agent/local-agent.ts` | 514 | `9ba6b49` (2026-06-20) | `LocalAgent` class; `runUntil`/`fork` are 1-line delegates (lines ~500) | stays delegate-only (over the 400 G8 guard already — add only a 1-line method) |
| `packages/sdk/src/types/run.ts` | 238 | `9ba6b49` (2026-06-20) | `SendOptions`/`RunResult`/`Run` | existing types unchanged; additive |
| `packages/sdk/src/types/agent.ts` | 799 | `9ba6b49` (2026-06-20) | `SDKAgent` interface (`send` line 582) | existing members unchanged; add `runToCompletion` |
| `packages/sdk/src/internal/runtime/cloud-agent/*` (CloudAgent) | n/a | `9ba6b49` (2026-06-20) | Cloud runtime impl of SDKAgent | mirror the `fork`/`runUntil` cloud behavior (throw `UnsupportedRunOperationError`) |
| `packages/sdk/src/index.ts` | n/a | `9ba6b49` (2026-06-20) | Public barrel | additive type exports |
| `packages/sdk/docs.md` | n/a | `9ba6b49` (2026-06-20) | Public API contract | additive |
| `packages/sdk/tests/run-to-completion.test.ts` (NEW) | 0 | — | (file to be created) | — |

### Current callers / dependents

- **Symbol:** `SDKAgent` interface (`types/agent.ts:556`) — implemented by `LocalAgent` and `CloudAgent`; consumed by every `Agent.create()` caller. External: yes (public API). Adding a required method forces both implementers to provide it.
- **Symbol:** `runUntilImpl` (`run-until.ts:27`) — the structural template; called via `localAgentRunUntil`. Not modified, only mirrored.
- **Symbol:** `run.wait()` (`types/run.ts:227`) — returns `RunResult` with `stoppedAtIterationLimit`. Consumed by the new driver.

### Domain glossary

- **stateful agent** — `LocalAgent.send` reads/appends conversation history from session storage, so a follow-up send resumes the same conversation.
- **continuation prompt** — a short instruction re-sent to make the model resume after a truncation (vs re-sending the whole task).
- **terminal** — the driver's exit reason: `done` (model finished), `step_limit` (round budget exhausted while still truncating), `no_progress` (two consecutive empty rounds).
- **round** — one `send().wait()` inside the driver.

### Architecture boundaries affected

Per `rules/architecture.md`: the driver impl lives in `internal/runtime/lifecycle/` (runtime layer), wired through the existing `local-agent-runtime-extensions` delegate seam — same pattern as `runUntil`/`fork`. The public surface is the `SDKAgent` interface + types in `types/`. No inner→outer dependency introduced. The impl depends on the injected `agent` port (the thing with `.send`), keeping it unit-testable.

## Prior Art & Related Work

- **Gap audit report** — `docs/gap-audit/THEOKIT_GAP_AUDIT.md` Tema A + master-table row M1-2 (continuation driver).
- **`runUntilImpl`** (`internal/runtime/lifecycle/run-until.ts`) — the structural template for an injectable, send-looping driver with abort handling. `runToCompletion` mirrors its shape minus the judge/event-stream.
- **theocode reference** — `theocode/server/lib/agent-loop.ts` — the hand-rolled outer loop (CONTINUE_PROMPT, STEP_LIMIT_NOTICE, NO_PROGRESS_NOTICE, per-round signal analysis) this driver absorbs.
- **Shipped foundation** — `SendOptions.maxIterations` + `RunResult.stoppedAtIterationLimit` (this milestone, 2.2.0) — the driver's input signal.

## Objective

- [ ] `agent.runToCompletion(message, options?)` is a public instance method on `SDKAgent`, implemented by `LocalAgent`
- [ ] The driver re-sends a continuation prompt while `stoppedAtIterationLimit` is true and progress is made; returns `terminal: 'done' | 'step_limit' | 'no_progress'` + `rounds` + `lastResult` + aggregated usage
- [ ] The driver core is a pure function driven by an injected `send`, unit-tested for every terminal deterministically (no real LLM)
- [ ] `CloudAgent.runToCompletion` throws `UnsupportedRunOperationError` (mirrors `fork`/`runUntil` cloud behavior)
- [ ] `AbortSignal` stops the loop between rounds
- [ ] `docs.md` + CHANGELOG + changeset updated; `pnpm quality:dead` clean for new surfaces

## ADRs

### ADR-RTC-1 — Pure, injectable driver core (`runToCompletionImpl(agent, message, options)`)

- **Decision:** The driver lives in `internal/runtime/lifecycle/run-to-completion.ts` as `runToCompletionImpl(agent, message, options)` where `agent` is the `{ send }` port; the loop does `await agent.send(prompt, opts); await run.wait()`. Pure decision helpers (`classifyRound`, `aggregateUsage`) are exported for granular tests. `LocalAgent.runToCompletion` is a 1-line delegate via `local-agent-runtime-extensions`.
- **Rationale:** Mirrors the proven `runUntilImpl` pattern. Injecting the `send` port makes the driver fully unit-testable with a fake that returns `RunResult`s with controlled `stoppedAtIterationLimit` — solving the fixture-mode limitation that fixtures never set that flag.
- **Alternatives considered:** (a) Implement inline in `LocalAgent` — rejected: `local-agent.ts` is already over the 400-LoC guard, and an inline loop is untestable without a real LLM. (b) Drive via fixture multi-turn — rejected: fixtures don't set `stoppedAtIterationLimit`, so terminals can't be exercised. (c) Build on `buildReplayHistory` — rejected: discovery proved the agent is stateful, so history reconstruction is unnecessary here.
- **Consequences:** Deterministic, exhaustive terminal tests. The driver depends only on the `send` port.

### ADR-RTC-2 — Re-send a continuation prompt (stateful agent), not the full task

- **Decision:** After a truncated round, re-send a short continuation prompt (a sensible default, overridable via options) rather than re-sending the original message or reconstructing history. The session preserves prior turns.
- **Rationale:** Discovery confirmed `LocalAgent.send` is stateful (`getSessionMessages`/`appendSessionMessage`). Re-sending the whole task would duplicate context and cost; the continuation prompt resumes cleanly — the exact approach `theocode` uses.
- **Alternatives considered:** (a) Re-send original message — rejected: duplicates work, confuses the model. (b) Reconstruct history via `buildReplayHistory` — rejected: redundant with session statefulness (that utility is for stateless replay, a separate item).
- **Consequences:** Driver is thin; correctness depends on session statefulness (documented). A custom `continuationPrompt` option is provided.

### ADR-RTC-3 — Terminals and no-progress detection

- **Decision:** `terminal` is `done` when a round is NOT truncated (`stoppedAtIterationLimit` falsy); `step_limit` when truncated AND `rounds` reached `maxRounds`; `no_progress` when two consecutive rounds produced no observable output (empty `result` text). `maxRounds` default 5.
- **Rationale:** Matches the theocode reference terminals. No-progress guards against a model that keeps truncating without advancing — a real failure mode an outer loop must catch.
- **Alternatives considered:** (a) Only a round cap — rejected: misses the no-progress stall. (b) Tool-call-count signal for progress — rejected: not reliably available on `RunResult` today; empty-output is the honest, available signal (documented as heuristic).
- **Consequences:** `no_progress` is heuristic (empty output). Documented. `maxRounds` is a hard ceiling preventing runaway loops.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Adding a required `runToCompletion` to `SDKAgent` forces `CloudAgent` to implement it | Medium | CloudAgent throws `UnsupportedRunOperationError`, mirroring its `fork`/`runUntil` behavior; typecheck enforces the implementation exists | impl |
| `no_progress` heuristic (empty output) could misclassify a legitimately quiet round | Low | Requires TWO consecutive empty rounds; documented as heuristic; `maxRounds` still bounds the loop | impl |
| A model that always truncates would loop to `maxRounds` (cost) | Medium | `maxRounds` default 5 hard ceiling; `onTruncated` callback exposes each round for caller metrics/early-abort | impl |
| Re-send continuation assumes session statefulness; a non-stateful runtime would lose context | Low | Local runtime is stateful (verified); documented as a local-runtime feature; cloud throws unsupported | impl |

## Unresolved Questions

- Q1 — Exact signal for "progress" in a round: is tool-call count exposed on `RunResult`, or only `result` text? (Resolve in T1 by reading `RunResult` fields; default to empty-`result` as the progress signal if tool-call count is unavailable.) — MUST-FIX before merge.
- Q2 — Does `CloudAgent` already centralize "unsupported local-only op" or must each method throw individually? (Resolve in T3 by reading the CloudAgent `fork`/`runUntil` impl.) — MUST-FIX before merge.

## Dependencies

No new third-party dependency. Pure internal driver + public type additions.

| Dependency | Version | New? | Rule 9 justification |
|---|---|---|---|
| (none) | — | — | The driver loops the SDK's own `send`; no library solves "re-send until terminal" for this API |

No CVE surface change.

## Dependency Graph

```
T1 (driver core + types) ──▶ T2 (LocalAgent wiring + delegate) ──▶ T3 (CloudAgent unsupported + barrel/docs)
```

Sequential: the core (T1) is testable alone; T2 wires it into LocalAgent; T3 satisfies the interface on CloudAgent + exposes/docs the public surface. One commit per task.

---

## Phase 1: Driver core + public types

### T1.1 — Implement the pure `runToCompletionImpl` + types

#### Objective
Create `run-to-completion.ts` with `runToCompletionImpl(agent, message, options)` + `classifyRound`/`aggregateUsage`, and the `RunToCompletionOptions`/`RunToCompletionResult` types.

#### Why this step (action + reasoning)

1. **What this step does** — writes the injectable driver loop (send → wait → classify → maybe re-send) and its pure helpers, plus the public option/result types.
2. **Why it is necessary now** — it is the testable heart of the feature; everything else is wiring. Building it pure-first (ADR-RTC-1) lets every terminal be proven deterministically before touching the agent classes.

#### Evidence
`run-until.ts:27` shows the exact `agent.send(prompt); run.wait()` loop shape + abort handling to mirror. `RunResult.stoppedAtIterationLimit` (shipped 2.2.0) is the input signal. `theocode/server/lib/agent-loop.ts` is the terminal/loop reference.

#### Files to edit
```
packages/sdk/src/internal/runtime/lifecycle/run-to-completion.ts — NEW: impl + classifyRound + aggregateUsage
packages/sdk/src/types/run.ts — RunToCompletionOptions + RunToCompletionResult
packages/sdk/tests/run-to-completion.test.ts — RED tests (fake-send driven)
```

#### Deep file dependency analysis
- `run-to-completion.ts` (NEW) — imports `SDKAgent` (port: only `.send` used), `RunResult`, `SendOptions`. No outer-layer import.
- `types/run.ts` (Baseline: 238 LoC) — additive types.

#### Deep Dives
- Loop: `for (round = 0; round <= maxRounds; round++) { result = await agent.send(round===0?message:continuationPrompt, sendOptions).wait(); aggregate(result); const c = classifyRound(result, round, maxRounds, emptyStreak); if c !== 'continue' return terminal }`.
- Invariant: `done` when `!result.stoppedAtIterationLimit`; bounded by `maxRounds`; signal aborts between rounds.
- Edge cases: round 0 finishes (rounds=0, done); always-truncate → step_limit; two empty → no_progress; aborted signal → stop with current terminal.

#### Pseudo-code / Signatures
```pseudocode
interface RunToCompletionOptions { maxRounds?: number; continuationPrompt?: string; onTruncated?: (e:{round:number})=>void|Promise<void>; signal?: AbortSignal; sendOptions?: SendOptions }
interface RunToCompletionResult { terminal: "done"|"step_limit"|"no_progress"; rounds: number; lastResult: RunResult; usage?: TokenUsage }
function classifyRound(r: RunResult, round: number, maxRounds: number, emptyStreak: number): "done"|"continue"|"step_limit"|"no_progress"
async function runToCompletionImpl(agent: {send}, message, options?): Promise<RunToCompletionResult>
```

#### Tasks
1. Write RED tests with a fake `agent.send` returning a scripted sequence of `RunResult`s.
2. Implement helpers + loop.
3. Resolve Q1 (progress signal) from `RunResult`.

#### TDD
```
RED:  test_returns_done_when_first_round_not_truncated() — rounds=0, terminal done
RED:  test_continues_then_done_when_truncated_then_finishes() — rounds=1, terminal done, usage aggregated
RED:  test_step_limit_when_always_truncating() — maxRounds=2 → terminal step_limit, rounds=2
RED:  test_no_progress_after_two_empty_rounds() — terminal no_progress
RED:  test_abort_signal_stops_between_rounds() — aborted → loop stops, no extra send
RED:  test_onTruncated_called_per_truncated_round() — callback count == truncated rounds
GREEN: implement runToCompletionImpl + classifyRound + aggregateUsage
REFACTOR: keep classifyRound pure; extract aggregation
VERIFY: pnpm --filter @theokit/sdk exec vitest run tests/run-to-completion.test.ts
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk exec vitest run tests/run-to-completion.test.ts` exits 0 (6 tests pass, fake-driven)
- [ ] `classifyRound` returns each of done/continue/step_limit/no_progress under the asserted conditions
- [ ] Pass: typecheck — `pnpm --filter @theokit/sdk run typecheck` zero errors
- [ ] Pass: lint — `pnpm --filter @theokit/sdk exec biome check` zero errors on changed files

#### DoD
- [ ] `pnpm --filter @theokit/sdk test` exits 0
- [ ] typecheck zero errors; biome zero errors on changed files
- [ ] CHANGELOG entry added under `[Unreleased]`

---

## Phase 2: Wire `runToCompletion` onto LocalAgent

### T2.1 — Delegate + interface member

#### Objective
Add `runToCompletion` to the `SDKAgent` interface, a 1-line `LocalAgent` delegate, and the `localAgentRunToCompletion` wiring.

#### Why this step (action + reasoning)

1. **What this step does** — exposes the driver as `agent.runToCompletion(...)` by mirroring the `runUntil`/`fork` delegate pattern.
2. **Why it is necessary now** — the core is useless until reachable from a real agent; this is the public wiring.

#### Evidence
`local-agent.ts:500` shows `runUntil` as a 1-line delegate to `localAgentRunUntil`; `local-agent-runtime-extensions.ts:32` shows the lazy-import wiring. `SDKAgent` interface at `types/agent.ts:556`.

#### Files to edit
```
packages/sdk/src/types/agent.ts — add runToCompletion to SDKAgent interface
packages/sdk/src/internal/runtime/local-agent/local-agent-runtime-extensions.ts — localAgentRunToCompletion (lazy-import impl)
packages/sdk/src/internal/runtime/local-agent/local-agent.ts — 1-line runToCompletion delegate
packages/sdk/tests/run-to-completion.test.ts — extend with the LocalAgent delegate-shape assertion
```

#### Deep file dependency analysis
- `types/agent.ts` (Baseline: 799 LoC) — one method on the interface.
- `local-agent.ts` (Baseline: 514 LoC) — one delegate line (stays delegate-only).
- `local-agent-runtime-extensions.ts` (Baseline: 94 LoC) — one wiring function mirroring `localAgentRunUntil`.

#### Deep Dives
- Invariant: `local-agent.ts` gains only a 1-line method (the file is already over the G8 guard; no bulk added).
- Edge cases: delegate passes options through unchanged.

#### Tasks
1. Add the interface member + delegate + wiring.
2. Assert the delegate is callable and returns the driver result shape.

#### TDD
```
RED:  test_localAgent_exposes_runToCompletion_method() — typeof agent.runToCompletion === "function"
GREEN: add interface member + delegate + wiring
REFACTOR: None expected
VERIFY: pnpm --filter @theokit/sdk exec vitest run tests/run-to-completion.test.ts && pnpm --filter @theokit/sdk run typecheck
```

#### Acceptance Criteria
- [ ] `import { Agent } from "@theokit/sdk"`; an agent instance exposes `runToCompletion` (typecheck + runtime typeof)
- [ ] `pnpm --filter @theokit/sdk run typecheck` zero errors (interface satisfied by LocalAgent)
- [ ] Pass: lint — biome zero errors on changed files

#### DoD
- [ ] `pnpm --filter @theokit/sdk test` exits 0
- [ ] typecheck zero errors; biome zero errors on changed files
- [ ] CHANGELOG updated

---

## Phase 3: CloudAgent unsupported + public surface

### T3.1 — CloudAgent throws + barrel/docs

#### Objective
Implement `CloudAgent.runToCompletion` to throw `UnsupportedRunOperationError`; export the new types; document.

#### Why this step (action + reasoning)

1. **What this step does** — satisfies the `SDKAgent` interface on the cloud runtime (throwing, like `fork`/`runUntil`) and exposes the public types + docs.
2. **Why it is necessary now** — the interface addition (T2.1) makes CloudAgent fail typecheck until it implements the method; and consumers need the types + docs.

#### Evidence
CloudAgent implements `SDKAgent`; `fork`/`runUntil` on cloud throw `UnsupportedRunOperationError` (the established local-only-op pattern). `index.ts` re-exports public types.

#### Files to edit
```
packages/sdk/src/internal/runtime/cloud-agent/<cloud-agent>.ts — runToCompletion throws UnsupportedRunOperationError
packages/sdk/src/index.ts — export RunToCompletionOptions/RunToCompletionResult types
packages/sdk/docs.md — document agent.runToCompletion
packages/sdk/CHANGELOG.md — finalize [Unreleased] Added entry
packages/sdk/.changeset/m1-run-to-completion.md — minor changeset
```

#### Deep file dependency analysis
- CloudAgent — one method throwing (mirrors existing unsupported ops). Resolve Q2 (centralized vs per-method) by reading its `fork`.
- `index.ts` — additive type exports.

#### Deep Dives
- Invariant: cloud behavior for local-only ops unchanged (throws the same typed error).
- Edge cases: none new.

#### Tasks
1. Add CloudAgent method (throw).
2. Export types; document; changeset.

#### TDD
```
RED:  test_cloudAgent_runToCompletion_throws_unsupported() — rejects with UnsupportedRunOperationError
GREEN: implement throwing method + exports + docs
REFACTOR: None expected
VERIFY: pnpm --filter @theokit/sdk run typecheck && pnpm --filter @theokit/sdk exec vitest run tests/run-to-completion.test.ts
```

#### Acceptance Criteria
- [ ] `CloudAgent.runToCompletion(...)` rejects with `UnsupportedRunOperationError` (asserted)
- [ ] `import type { RunToCompletionOptions, RunToCompletionResult } from "@theokit/sdk"` resolves
- [ ] `pnpm --filter @theokit/sdk run typecheck` zero errors (both runtimes satisfy the interface)
- [ ] `pnpm quality:dead` reports no dead exports for the new types
- [ ] `docs.md` documents `runToCompletion`; `CHANGELOG.md` + changeset present

#### DoD
- [ ] `pnpm --filter @theokit/sdk test` exits 0
- [ ] typecheck zero errors; biome zero errors on changed files
- [ ] build + attw green; CHANGELOG + changeset updated

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | M1 Phase 3 — public continuation driver | T1.1 + T2.1 | `runToCompletionImpl` core + `agent.runToCompletion` delegate |
| 2 | Terminals done/step_limit/no_progress + aggregation | T1.1 | `classifyRound` + `aggregateUsage`, fake-driven tests |
| 3 | Cloud runtime satisfies the interface | T3.1 | `CloudAgent.runToCompletion` throws `UnsupportedRunOperationError` |

**Coverage: 3/3 gaps mapped (100%)**

> M1-3 (`buildReplayHistory`) is explicitly OUT of scope — discovery proved the agent is stateful, so the driver needs no history reconstruction. M1-4/M1-5/M1-6 are independent follow-on items, not part of this slice.

## Global Definition of Done

- [ ] All 3 phases completed
- [ ] `pnpm --filter @theokit/sdk test` exits 0
- [ ] `pnpm --filter @theokit/sdk run typecheck` zero errors (both runtimes implement the interface)
- [ ] `pnpm --filter @theokit/sdk exec biome check` zero errors on changed files
- [ ] every changed file ≤ 500 lines (`run-to-completion.ts` self-contained; `local-agent.ts` gains only 1 line)
- [ ] `CHANGELOG.md` updated under `[Unreleased]` + changeset present
- [ ] Backward compatibility: existing exports/signatures unchanged; `SDKAgent` gains one method (both implementers provide it)
- [ ] `pnpm quality:dead` reports zero unallowlisted dead exports for the new surfaces
- [ ] `docs.md` documents `agent.runToCompletion` with an example
- [ ] `pnpm --filter @theokit/sdk run build` + `attw` green

## Final Phase: Integration Validation (MANDATORY)

**Objective:** Validate the driver + wiring in the real test suite.

### Execution
```
pnpm --filter @theokit/sdk test
pnpm --filter @theokit/sdk run typecheck
pnpm --filter @theokit/sdk exec biome check
pnpm --filter @theokit/sdk run build
pnpm quality:dead
```

### Acceptance Criteria
- [ ] All suites green; zero type/lint errors; build + attw green; quality:dead clean
- [ ] Wiring proof: the core's terminals are exercised by the fake-driven tests (real decision logic, not a stub), and `agent.runToCompletion` is callable (typecheck + typeof)

### If Validation Fails
1. Separate plan-caused failures from pre-existing (e.g., the known `@theokit/cli` turbo-concurrency flake).
2. Fix all plan-caused failures; re-run.
3. Pre-existing issues logged in the PR description, not blocking.
