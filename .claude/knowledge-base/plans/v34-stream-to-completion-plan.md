---
slug: v34-stream-to-completion
milestone_id: V3-4
created_at: 2026-06-24
goal: Add a streaming continuation driver (agent.streamToCompletion) to @theokit/sdk
---

# Plan: V3-4 — streaming continuation driver (`agent.streamToCompletion`)

> **v1.1 (2026-06-24):** absorbed edge-case MUST-FIX EC-1 (the `StreamToCompletionResult` return value is invisible to `for await...of` — add a manual-`next()` consumption test + docs.md pattern, mirroring theocode `headless-runner.ts:96-106`) + SHOULD-TEST EC-2 (early-break cleanup) + DOCUMENT EC-3 (maxRounds=0 boundary).

## Goal

> "Enable `@theokit/sdk` local agents to drive a multi-round continuation loop that EMITS events live (the streaming gap V3-4 (a)), measured by `pnpm --filter @theokit/sdk test` passing `tests/.../stream-to-completion*.test.ts` — a fake multi-round stream yields every round's `SDKMessage`s in order AND terminates on `done`/`step_limit`/`no_progress`."

## Context

V3-4 (ROADMAP-v3, gap V2-2A-2). The SDK already ships a continuation driver, `agent.runToCompletion` (M1, public — docs.md:302), whose pure `classifyRound` returns the exact V3-4 terminals (`done`/`step_limit`/`no_progress`) + bounded re-prompt — its docstring states it "absorbs the outer-loop policy hand-rolled in theocode/agent-loop.ts". The stateless path is also covered: `buildReplayHistory` (public — docs.md:330). The ONLY V3-4 criterion not covered is **(a) streaming**: `runToCompletion` is non-streaming (`run.wait()`), so a UI cannot render each round's events live. This plan adds `agent.streamToCompletion` — the streaming twin of `runToCompletion` — reusing `classifyRound` + `addUsage` verbatim (no re-derivation of the terminal policy).

The owner chose to extend the SDK (over the roadmap's app-policy escape hatch). To respect ADR 0031 / "SDK does not grow speculative scope": this is NOT a second policy — it is the SAME `classifyRound` policy surfaced over `Run.stream()` instead of `Run.wait()`. Stateless remains `buildReplayHistory`'s job (documented), not duplicated here.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC | Why it exists |
|---|---|---|
| `packages/sdk/src/types/run.ts` | ~340 | `RunOperation` enum (`:32`), `RunToCompletionOptions`/`Result`, `Run` (`stream()`+`wait()`, `:279/281`) |
| `packages/sdk/src/types/agent.ts` | ~700 | `SDKAgent` interface; `runToCompletion?` at `:669` |
| `packages/sdk/src/internal/runtime/lifecycle/run-to-completion.ts` | 155 | `classifyRound` (`:49`, pure), `addUsage`, `runToCompletionImpl` — the structure to mirror |
| `packages/sdk/src/internal/runtime/lifecycle/stream-to-completion.ts` (NEW) | ~90 | the streaming driver `streamToCompletionImpl` |
| `packages/sdk/src/internal/runtime/local-agent/local-agent.ts` | ~520 | local agent wires `runToCompletion` at `:508`; add `streamToCompletion` |
| `packages/sdk/src/internal/runtime/local-agent/local-agent-runtime-extensions.ts` | ~70 | binds the impl to the agent's `send` port (`:52-65`) |
| `packages/sdk/src/internal/runtime/cloud/cloud-agent.ts` | — | cloud agents throw `UnsupportedRunOperationError` for continuation ops |
| `docs.md` | — | document `streamToCompletion` next to `runToCompletion` (§ continuation) |
| `packages/sdk/tests/.../stream-to-completion.test.ts` (NEW) | — | unit tests (fake stream+wait port) |

### Current callers / dependents

- `classifyRound` (`run-to-completion.ts:49`) — pure, exported `@internal`; consumed by `runToCompletionImpl`. The new driver imports + reuses it (no copy).
- `RunOperation` (`run.ts:32`) — consumed by `UnsupportedRunOperationError` + `supports()`. Adding `"streamToCompletion"` is additive.
- `SDKAgent.streamToCompletion?` — optional method (like `runToCompletion?`), so no existing implementer breaks; cloud throws.
- `Run` exposes both `stream(): AsyncGenerator<SDKMessage, void>` (`:279`) and `wait(): Promise<RunResult>` (`:281`) on the same handle — the driver streams then waits per round.

### Domain glossary

- **continuation driver** — an outer loop that re-sends after a truncated round until a genuine terminal.
- **streaming twin** — same `classifyRound` policy, but yields each round's `SDKMessage`s live instead of returning only the final result.
- **terminal** — `done` (round finished untruncated) / `step_limit` (`maxRounds` hit) / `no_progress` (2 empty rounds).
- **stateful** — the agent's session preserves history; the continuation prompt is short (does NOT repeat the task). Both `runToCompletion` and this driver are stateful; the STATELESS path is `buildReplayHistory` (unchanged).

### Architecture boundaries affected

Entirely inside `packages/sdk/src/internal/runtime/lifecycle/` + the agent surface types + local/cloud agent wiring. ADR 0031 respected: the SDK already owns `runToCompletion` (a continuation driver); this is its streaming sibling, NOT a new policy layer. No new dependency.

## Prior Art & Related Work

- **In-SDK**: `run-to-completion.ts` (M1, plan `m1-run-to-completion`) — the non-streaming driver + `classifyRound` this plan reuses verbatim. `buildReplayHistory` (`internal/runtime/context/replay-history.ts`) — the stateless-history primitive.
- **theocode `server/lib/agent-stream.ts` `runCodeAgent`** (the V2-2A-2 spec) — a streaming + stateless + reflection-aware `AsyncGenerator`. Its terminal classification maps to `classifyRound`; its reflection ladder (`selectReflection`: verify-fix/requireEdit/edits-guard) is code-assistant DOMAIN that STAYS app-policy (per the roadmap) — NOT ported into the SDK.
- **`@theokit/agents` `runReflectiveLoop`** (V4-D) — a non-streaming multi-round driver in the bridge; orthogonal (different repo/layer), not duplicated.

## Objective

Ship `agent.streamToCompletion(message, options?): AsyncGenerator<SDKMessage, StreamToCompletionResult>` for local agents — streaming twin of `runToCompletion`, reusing `classifyRound`/`addUsage`. Cloud agents throw `UnsupportedRunOperationError`. Document that stateless = `buildReplayHistory`. Zero new dependency.

## ADRs

### D1 — Streaming twin reuses `classifyRound`; NOT a new terminal policy

**Decision:** `streamToCompletionImpl` imports `classifyRound` + `addUsage` from `run-to-completion.ts` (the M1 driver) and applies them per round, yielding each round's `SDKMessage`s before classifying via `run.wait()`.

**Rationale:** the terminal policy (done/step_limit/no_progress, the V3-4 (c) criterion) is already proven + unit-tested in M1. Re-deriving it would be re-work (the user's "sem re-trabalho" directive) AND risk divergence. The streaming driver differs from `runToCompletion` ONLY in surfacing events live (criterion (a)). Alternatives: copy classifyRound (rejected — duplication); a fully independent streaming policy (rejected — divergence + scope-creep).

### D2 — Stateful, like `runToCompletion`; stateless stays `buildReplayHistory`

**Decision:** the driver is stateful (the agent's session preserves history; short continuation prompt). The V3-4 (b) stateless criterion is served by the existing public `buildReplayHistory` — a consumer reconstructs history into a fresh session then drives `streamToCompletion`. This driver does NOT take an accumulated-history argument.

**Rationale:** mirroring `runToCompletion`'s stateful model keeps ONE continuation contract (DRY); `buildReplayHistory` already covers stateless (docs.md:330) — adding a history param here would duplicate it + bloat the signature (YAGNI). Alternatives: a stateless `streamToCompletion(history, ...)` overload (rejected — duplicates buildReplayHistory; no consumer asked for the combined call). Documented in docs.md so the stateless+streaming combination is discoverable.

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| A round's `run.wait()` must be drained AFTER `run.stream()` is consumed; consuming order wrong could deadlock or drop the result | MEDIUM | Per round: fully drain `stream()` (yield each msg) THEN `await wait()` on the same handle — the documented `Run` contract (`run.ts:62` "consumers that don't drain stream() still get the cause via wait()"); unit-test asserts all round-1 msgs are yielded before round-2 starts | implementer |
| Abort mid-stream (vs between rounds) leaves a partially-yielded round | LOW | `signal` checked between rounds (mirrors runToCompletion); mid-round abort surfaces via the SDK stream's own cancellation; test the between-rounds abort path | implementer |
| Cloud agent silently no-ops instead of throwing | LOW | cloud-agent throws `UnsupportedRunOperationError("streamToCompletion")` like the other continuation ops; a cloud unit test asserts the throw | implementer |

## Unresolved Questions

(none — every decision is resolved at plan time: reuse classifyRound (D1), stateful + buildReplayHistory for stateless (D2), cloud throws.)

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| (internal only) | — | — | reuses `classifyRound`/`addUsage` from the same package; no external dep |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | | | The driver is pure orchestration over the existing `Run` surface | — |

### Removed

| Package | Last version | Why removed |
|---|---|---|

## Dependency Graph

```
Phase 1 (types) ──▶ Phase 2 (driver + wiring) ──▶ Phase 3 (Integration Validation: docs + cloud-throw + full suite)
```

## Phase 1: Types

### T1.1 — Add `streamToCompletion` to the public type surface

#### Objective
Add `"streamToCompletion"` to `RunOperation`, a `StreamToCompletionResult` type, and the optional `SDKAgent.streamToCompletion?` method signature.

#### Why this step (action + reasoning)
Action: extend `run.ts` (`RunOperation` union + `StreamToCompletionResult` = `{ terminal; rounds; lastResult; usage? }`, reusing `RunToCompletionOptions`) and `agent.ts` (`streamToCompletion?(message, options?): AsyncGenerator<SDKMessage, StreamToCompletionResult>`). Reasoning: the type surface must exist before the impl + the cloud-throw can reference the operation (D1); reusing `RunToCompletionOptions` keeps one options contract (DRY).

#### Evidence
`run.ts:32` (RunOperation), `:99/126` (RunToCompletion types), `agent.ts:669` (runToCompletion signature to mirror).

#### Files to edit
- `packages/sdk/src/types/run.ts` — `RunOperation` += `"streamToCompletion"`; add `StreamToCompletionResult`.
- `packages/sdk/src/types/agent.ts` — `streamToCompletion?` optional method.

#### Deep file dependency analysis
`RunOperation` is consumed by `UnsupportedRunOperationError` + `supports()`; additive union member is safe. `SDKAgent.streamToCompletion?` is optional → no existing implementer breaks. `docs.md` MUST be updated in the same slice (public-surface rule).

#### TDD
```
test_stream_to_completion_types — a value satisfying StreamToCompletionResult (terminal:'done', rounds:0, lastResult) typechecks; RunOperation accepts 'streamToCompletion' (expectTypeOf / type-test).
```

#### Concurrency tests (only when applicable)
(none — single-threaded). Type-only change; no shared state, no async control flow.

#### Acceptance Criteria
- `test_stream_to_completion_types` passes: `expectTypeOf` confirms `StreamToCompletionResult` (terminal/rounds/lastResult) is assignable and `RunOperation` accepts `'streamToCompletion'`.
- `grep -c '"streamToCompletion"' packages/sdk/src/types/run.ts` returns ≥ 1 (the operation is in the union).
- `pnpm --filter @theokit/sdk typecheck` exits 0.

#### DoD
- typecheck clean; docs.md surface updated; type-test green.

## Phase 2: Driver + wiring

### T2.1 — `streamToCompletionImpl` (streaming driver) + local-agent wiring + cloud throw

#### Objective
Implement the `AsyncGenerator` driver reusing `classifyRound`/`addUsage`; wire it on the local agent; make cloud agents throw `UnsupportedRunOperationError`.

#### Why this step (action + reasoning)
Action: new `stream-to-completion.ts` — per round `const run = await agent.send(prompt, sendOptions); for await (const m of run.stream()) yield m; const result = await run.wait();` then `classifyRound` → continue/terminal; bounded by `maxRounds`; signal checked between rounds; return `StreamToCompletionResult`. Wire on local agent (mirror `local-agent.ts:508`); cloud throws. Reasoning: streams each round's events live (the (a) gap) while reusing the proven terminal policy (D1).

#### Evidence
`run-to-completion.ts:108-154` (the loop to mirror), `run.ts:279/281` (`stream()`+`wait()` on `Run`).

#### Files to edit
- `packages/sdk/src/internal/runtime/lifecycle/stream-to-completion.ts` (NEW) — the driver.
- `packages/sdk/src/internal/runtime/local-agent/local-agent.ts` + `local-agent-runtime-extensions.ts` — wire it.
- `packages/sdk/src/internal/runtime/cloud/cloud-agent.ts` — throw `UnsupportedRunOperationError`.
- `packages/sdk/tests/.../stream-to-completion.test.ts` (NEW) — unit tests.

#### Deep file dependency analysis
The driver's port is `{ send(prompt, opts): Promise<{ stream(): AsyncGenerator<SDKMessage>; wait(): Promise<RunResult> }> }` — a subset of `Run`, injectable for a fake. Reuses `classifyRound`/`addUsage` (imported, not copied). Local agent's `.send()` already returns a `Run` with both methods.

#### Pseudo-code / Signatures
```ts
export async function* streamToCompletionImpl(agent, message, options?):
  AsyncGenerator<SDKMessage, StreamToCompletionResult> {
  const maxRounds = options?.maxRounds ?? DEFAULT_MAX_ROUNDS
  let state = { usage: undefined, emptyStreak: 0 }
  for (let round = 0; ; round++) {
    const prompt = round === 0 ? message : (options?.continuationPrompt ?? DEFAULT)
    const run = await agent.send(prompt, options?.sendOptions)
    for await (const msg of run.stream()) yield msg          // (a) STREAMING
    const result = await run.wait()
    const usage = addUsage(state.usage, result.usage)         // reuse
    const decision = classifyRound(result, round, maxRounds, state.emptyStreak)  // reuse
    if (decision !== 'continue') return { terminal: decision, rounds: round, lastResult: result, ...(usage && {usage}) }
    state = { usage, emptyStreak: isEmptyRound(result) ? state.emptyStreak+1 : 0 }
    await options?.onTruncated?.({ round })
    if (options?.signal?.aborted) return { terminal: 'step_limit', rounds: round, lastResult: result, ...(usage && {usage}) }
  }
}
```

#### TDD
```
test_stream_to_completion_yields_each_round_events_in_order — fake port: round0 emits [m0a,m0b] truncated, round1 emits [m1a] done ⇒ generator yields [m0a,m0b,m1a] in order AND returns { terminal:'done', rounds:1 }.
test_stream_to_completion_done_first_round — round0 done (not truncated) ⇒ yields round0 msgs, returns { terminal:'done', rounds:0 }.
test_stream_to_completion_step_limit — every round truncates; maxRounds=2 ⇒ returns { terminal:'step_limit', rounds:2 }.
test_stream_to_completion_no_progress — two consecutive empty truncated rounds ⇒ { terminal:'no_progress' }.
test_stream_to_completion_aborts_between_rounds — signal aborts after round0 ⇒ stops, returns step_limit, round1 never sent.
test_stream_to_completion_return_value_via_manual_next — EC-1: drive with `while(!res.done) res = await gen.next()`; assert `res.value` is the StreamToCompletionResult (terminal/rounds/usage). The result is the generator RETURN value, invisible to a plain `for await...of` (the theocode headless-runner idiom).
test_stream_to_completion_early_break_cleanup — EC-2: caller breaks after the first yielded msg ⇒ the next round is never sent (no further `send`), the in-flight round is not re-entered (generator return path runs).
test_cloud_agent_stream_to_completion_throws — cloud agent.streamToCompletion throws UnsupportedRunOperationError.
```

#### Concurrency tests (only when applicable)
(none — single-threaded). The driver awaits each round sequentially; `stream()` is drained before `wait()` on the same handle (no parallel consumption). The only async is the per-round await + the generator's own back-pressure — no shared mutable state across concurrent tasks.

#### Acceptance Criteria
- `pnpm --filter @theokit/sdk exec vitest run stream-to-completion` passes all 8 tests (round-order, done@0, step_limit, no_progress, abort, return-value-via-manual-next [EC-1], early-break-cleanup [EC-2], cloud-throw).
- `test_cloud_agent_stream_to_completion_throws` passes: a cloud agent's `streamToCompletion` throws `UnsupportedRunOperationError`.
- `grep -c 'function classifyRound' packages/sdk/src/internal/runtime/lifecycle/*.ts` returns exactly 1 (reused, not copied).

#### DoD
- `pnpm --filter @theokit/sdk test` green; typecheck + biome clean; no `classifyRound` copy (grep shows one definition).

## Coverage Matrix

| Requirement (Goal / V3-4) | Task(s) |
|---|---|
| (a) streaming — emit each round's events live | T2.1 |
| (c) terminals done/step_limit/no_progress + bounded re-prompt | T1.1 (types) + T2.1 (reuse classifyRound) |
| (b) stateless — documented as `buildReplayHistory` (not duplicated) | T1.1/T2.1 docs (ADR D2) |
| cloud agents throw (local-only) | T2.1 |
| no new dependency | all |
| Integration: streaming round-order + terminals end-to-end | Phase 3 |

100% — every Goal/V3-4 criterion maps to a task (b explicitly delegated to the existing primitive, per ADR D2).

## Failure scenarios (when I/O external)

The driver's only boundary is the injected agent `send`/`stream`/`wait` port (the SDK runtime; in tests a fake). A round that throws mid-stream propagates as the generator throwing (caller's `for await` sees it) — mirrors `runToCompletion`'s error surface. `(no NEW external I/O — the driver orchestrates the existing Run surface; a round error propagates through the generator, asserted by the abort/error test.)`

## Global Definition of Done

- [ ] All tasks committed; DoD checkboxes true.
- [ ] `pnpm --filter @theokit/sdk test` green (incl. 7 new tests).
- [ ] `pnpm --filter @theokit/sdk typecheck` clean; biome clean.
- [ ] `classifyRound` has exactly ONE definition (reused, not copied) — `grep -c "function classifyRound"`.
- [ ] docs.md documents `streamToCompletion` + the stateless=`buildReplayHistory` note.
- [ ] CHANGELOG `[Unreleased]` updated; changeset `@theokit/sdk` minor.

## Final Phase: Integration Validation (MANDATORY)

### Execution
- `pnpm --filter @theokit/sdk test` (full + 7 new), `typecheck`, `biome check`.
- Confirm `streamToCompletion` reuses `classifyRound` (one definition).
- Cloud-throw test green.

### Acceptance Criteria
- Streaming round-order + all terminals proven; cloud throws; full suite green.

### If Validation Fails
Return to the failing task; do NOT emit `IMPLEMENTATION_COMPLETE` until the suite passes.
