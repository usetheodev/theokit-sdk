# Implementation: M1 Phase 3 — `runToCompletion` continuation driver

**Slug:** `m1-run-to-completion`
**Date:** 2026-06-20
**Plan:** `knowledge-base/plans/m1-run-to-completion-plan.md` (verdict SHIPPABLE 98.0)
**Promise:** `IMPLEMENTATION_COMPLETE`

## What shipped

`agent.runToCompletion(message, options?)` — a public, local-agent continuation driver that consumes M1-2's `RunResult.stoppedAtIterationLimit` signal and re-sends a short continuation prompt until a genuine terminal. Absorbs the outer continuation loop a builder otherwise hand-rolls (proven by `theocode/server/lib/agent-loop.ts`).

## Files

| File | Change |
|---|---|
| `packages/sdk/src/internal/runtime/lifecycle/run-to-completion.ts` | NEW — pure-injectable core: `runToCompletionImpl`, `classifyRound`, `stepRound`, `addUsage`, `buildResult`, `RunToCompletionAgent` port. |
| `packages/sdk/src/types/run.ts` | `RunToCompletionOptions` + `RunToCompletionResult` interfaces; `"runToCompletion"` added to `RunOperation` union. |
| `packages/sdk/src/types/agent.ts` | `SDKAgent.runToCompletion?()` optional method. |
| `packages/sdk/src/internal/runtime/local-agent/local-agent-runtime-extensions.ts` | `localAgentRunToCompletion` delegate (binds the impl to the agent's stateful `send`). |
| `packages/sdk/src/internal/runtime/local-agent/local-agent.ts` | 1-line `runToCompletion()` method on `LocalAgent`. |
| `packages/sdk/src/internal/runtime/cloud/cloud-agent.ts` | `runToCompletion(): never` → `UnsupportedRunOperationError`. |
| `docs.md` | "Reliable continuation (local agents)" section + `RunResult.stoppedAtIterationLimit` (also retroactively documents M1-2's `maxIterations`). |
| `.changeset/m1-run-to-completion.md` | minor bump changeset. |
| `packages/sdk/tests/run-to-completion.test.ts` | NEW — 10 unit tests (fake-send injected): `classifyRound` matrix + driver terminals (`done`/`step_limit`/`no_progress`), usage aggregation, `onTruncated`, abort. |
| `packages/sdk/tests/run-to-completion-wiring.test.ts` | NEW — wiring integration: real `LocalAgent.runToCompletion()` in fixture mode crosses the class→extensions→impl→`send` boundary. |

## Terminals (ADR-RTC core)

- `done` — a round finished without `stoppedAtIterationLimit`.
- `step_limit` — `maxRounds` (default 5) exhausted, or `signal` aborted, while still truncating.
- `no_progress` — two consecutive rounds with empty `result` text.

## Wiring triad

- **(a) Caller** — `LocalAgent.runToCompletion()` → `localAgentRunToCompletion` → `runToCompletionImpl`, reachable from the public `Agent` surface.
- **(b) Integration test** — `run-to-completion-wiring.test.ts` constructs a real `LocalAgent` and drives a real `send` (fixture mode) to a `done` terminal, crossing the boundary the unit test mocks.
- **(c) Runtime observability** — the `onTruncated({ round })` callback is the per-round observability seam (caller-provided), consistent with the SDK's callback/opt-in-OTel instrumentation pattern (matches the `runUntil` precedent — no bespoke global metric).

## Why no `buildReplayHistory` (M1-3)

The agent is STATEFUL — `LocalAgent.send` persists conversation history in session storage, so a re-send resumes with full context. History reconstruction (M1-3) is unnecessary here and stays an independent roadmap item.

## Gates

- Unit + wiring tests: 18/18 GREEN (11 initial + 7 added in the review round).
- Full SDK suite: 368 files / 2678 tests passed, 0 failed (19/35 skips are Ollama/env-gated).
- `tsc --noEmit`: clean.
- Biome (incl. cognitive-complexity ≤ 10): clean — core decomposed into `stepRound` + `buildResult` to stay under the cap.
- knip (dead-code): clean.

## Review round (cycle-review, 5 specialist agents)

Verdicts: 3 READY, 2 NEEDS_FIXES (2 HIGH each). All confirmed findings fixed:

| Finding | Sev | Resolution |
|---|---|---|
| `CloudAgent.runToCompletion` throw path untested | HIGH | Added `cloud agents throw UnsupportedRunOperationError` test. |
| Abort test too weak (couldn't distinguish abort from budget exhaustion) | HIGH | Tightened to assert `sends == ["do X"]` + `rounds === 0`. |
| docs.md example didn't compile (optional method invoked bare) | HIGH | Example now uses `agent.runToCompletion?.(...)` + `undefined` guard. |
| `rounds` semantics documented inconsistently | HIGH | Precise JSDoc in `run.ts` + matching docs.md ("round 0 = initial send; step_limit → rounds === maxRounds"). |
| Root `CHANGELOG.md [Unreleased]` missing entry | MEDIUM | Added `### Added` bullet for `agent.runToCompletion()`. |
| `totalTokens` aggregation could violate EC-10 invariant | LOW | `addUsage` now DERIVES `totalTokens = Σin + Σout` instead of summing the field. |
| classifyRound priority (no_progress vs step_limit) untested | MEDIUM | Added boundary tests (no_progress beats step_limit; non-empty-at-budget = step_limit). |
| no-usage → undefined untested; default continuationPrompt untested; maxRounds=0 untested | LOW | Added the three tests. |

Kept as plan-approved design (documented, not defects): abort maps to `terminal: "step_limit"` (plan said "stop with current terminal"; documented in `run.ts` + docs.md + changeset); `RunOperation` in docs.md stays the Run-scoped subset (agent-level ops documented in prose); `runToCompletion?` optional, consistent with `runUntil?`/`fork?`.
