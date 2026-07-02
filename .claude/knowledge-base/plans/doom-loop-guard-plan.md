# Plan: Doom-loop / no-progress guard for the `@theokit/sdk` agent loop

> Version 1.1 · slug `doom-loop-guard` · 2026-07-01 · consumes blueprint `.claude/knowledge-base/discoveries/blueprints/doom-loop-guard-blueprint.md` (SHIPPABLE_WITH_CAVEATS 89.0). (v1.1 absorbed 2 MUST-FIX + 1 SHOULD-TEST from `.claude/knowledge-base/reviews/doom-loop-guard-edge-cases-2026-07-01.md`: EC-1 soft fires once (==softThreshold), EC-2 classifyRound doom-loop precedes iteration-limit, EC-3 undefined-key signature.)

## Goal

Add a pure, dependency-free `DoomLoopTracker` (canonical key-sorted-JSON tool-call signature + consecutive-identical counter + soft/hard thresholds) inspected per iteration in `continueOrTerminate`, so the SDK inner loop stops an identical-repeat doom loop with a typed `no_progress` terminal, verified by a new `tests/doom-loop-*.test.ts` suite (≥ 20 cases) passing green AND `run-to-completion`'s `classifyRound` returning `"no_progress"` on the doom-loop signal.

- Metric: `pnpm --filter @theokit/sdk exec vitest run tests/doom-loop-tracker.test.ts tests/agent-loop-doom-loop-wiring.test.ts tests/run-to-completion.test.ts` exits 0 with ≥ 20 new passing cases.

## Context

The SDK inner loop (`packages/sdk/src/internal/agent-loop/loop.ts:50` `while (budget.shouldContinue())`) drives LLM→tool→LLM iterations until the model stops or the iteration budget (default 8) exhausts. The outer continuation driver (`run-to-completion.ts:62`) already ships a `no_progress` terminal — but it fires ONLY on **empty rounds** (`isEmptyRound(result) && emptyStreak >= 1`). The P0 qwen3-coder hang produced NON-empty rounds (repeated `read_file(\n…)` → `not_found`), so `no_progress` never fired and the loop ground to the iteration ceiling / re-sent across rounds. This plan adds the missing detector — identical-repeat tool calls — as a pure tracker plugged into the loop, emitting a typed stop that COMPLEMENTS the empty-round `no_progress` (blueprint D5). Compliance: `rules/architecture.md` (pure injectable domain tracker, DIP — plugged into the existing tracker seam), `rules/testing.md` (pure state machine unit-testable + a loop integration test), `rules/error-handling.md` (typed terminal + clear resumable message, never a silent hang), `rules/parsimony-ladder.md` (no new dependency — a canonical signature + an integer counter).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last touch | Role today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk/src/internal/agent-loop/loop.ts` | ~360 | 2026-07 (T3.1 sanitize import) | `runAgentLoop` (`:32`) `while (budget.shouldContinue())` (`:50`); `continueOrTerminate` (`:323`) dispatches tools (`:336`) + returns continue/done/error | the LLM→tool→LLM streaming contract stays linear; existing budget/iteration-limit behavior unchanged |
| `packages/sdk/src/internal/agent-loop/loop-context-init.ts` | ~90 | — | `LoopContext` (`:17`) — `events`, `tools`, `finalStatus`, `stoppedAtIterationLimit?` (`:30`) | ctx shape additive only |
| `packages/sdk/src/internal/agent-loop/loop-types.ts` | ~205 | — | `AgentLoopInputs` + `AgentLoopOutput` (`:173`, `stoppedAtIterationLimit?` `:203`) | additive fields only |
| `packages/sdk/src/internal/runtime/lifecycle/run-to-completion.ts` | 215 | 2026-06 (M1) | `classifyRound` (`:54`) maps `stoppedAtIterationLimit`/empty-round → `done`/`step_limit`/`no_progress` | empty-round `no_progress` + `step_limit` unchanged |
| `packages/sdk/src/internal/runtime/lifecycle/stream-to-completion.ts` | ~ | 2026-06 (V3-4) | streaming twin — shares `classifyRound`/`isEmptyRound` | same terminal semantics as the stateful twin |
| `packages/sdk/src/types/run.ts` | ~ | — | `RunResult` (`:53`, `stoppedAtIterationLimit?` `:96`); `RunToCompletionResult.terminal` (`:138` = `done\|step_limit\|no_progress`); `SendOptions` (`:212`) | additive optional fields; terminal token set unchanged (reuse `no_progress`) |
| `packages/sdk/src/internal/agent-loop/doom-loop-tracker.ts` | (NEW) | — | the pure `DoomLoopTracker` | pure, sync, no I/O import |
| `packages/sdk/src/internal/agent-loop/tool-dispatch.ts` | ~230 | — | `dispatchTools` (`:32`); each call has `.name` + `.input` (`:74`, `:175`) | (read-only reference — the fingerprint source) |
| `packages/sdk/docs.md` | ~ | — | public API contract | new `SendOptions.doomLoop` + `RunResult.stoppedByDoomLoop` reflected |
| `packages/sdk/tests/doom-loop-tracker.test.ts` + `tests/agent-loop-doom-loop-wiring.test.ts` | (NEW) | — | RED suites | `tests/**/*.test.ts` picked up by vitest (`vitest.config.ts:12`) |

### Current callers / dependents

- `continueOrTerminate` (`loop.ts:323`) — sole caller is `runIteration`→`runAgentLoop` (same file); the tool calls it dispatches are `llmOutput.toolCalls` (each `{id, name, input}`), the fingerprint source.
- `classifyRound` (`run-to-completion.ts:54`) — called by `runToCompletionImpl` (`:179` via `stepRound`) AND the streaming twin `stream-to-completion.ts` (shared export). Both must handle the doom-loop signal identically.
- `RunResult.stoppedAtIterationLimit` — set by the loop (`loop.ts:65`,`:89`), read by `classifyRound` (`run-to-completion.ts:60`). The new `stoppedByDoomLoop` follows the same set-in-loop / read-in-driver path.
- `SendOptions` (`types/run.ts:212`) — public; consumed by `Agent.send`. Adding an optional `doomLoop` field is additive/backward-compatible.

### Domain glossary

- **Doom loop** — the model repeating IDENTICAL tool calls (same name + same canonical input) across iterations, making no progress (the P0 `read_file`/`not_found` hang).
- **Tool-call signature** — a canonical string identity of a call: `name + JSON.stringify(sortKeys(input))` (key-sorted so `{a,b}`==`{b,a}`).
- **Soft threshold** — consecutive-identical count at which a guidance nudge is warranted (continue). **Hard threshold** — count at which the run stops.
- **`no_progress` terminal** — the outer driver's stop reason; today = empty rounds; this plan adds identical-repeat as a second trigger (blueprint D5).
- **Pluggable iteration-tracker seam** — the existing `loop.ts` gate (`budget.shouldContinue()` / `budgetTracker` deny-with-reason) that stops the loop; the doom-loop guard plugs alongside it (inspecting tool calls, which the budget gate does not see).

### Architecture boundaries affected

- `DoomLoopTracker` is a **pure internal domain tracker** (no I/O, no transport import) in `internal/agent-loop/`. Per `rules/architecture.md` DIP, the loop (orchestrator) owns/injects it; the tracker knows nothing of the loop.
- New PUBLIC surface: `SendOptions.doomLoop?` + `RunResult.stoppedByDoomLoop?` → `docs.md` MUST reflect them (SDK CLAUDE.md § Checklist). The terminal token set (`done|step_limit|no_progress`) is UNCHANGED — `no_progress` is reused (blueprint D5 variant), so no new public terminal token.

## Prior Art & Related Work

- Internal blueprint `.claude/knowledge-base/discoveries/blueprints/doom-loop-guard-blueprint.md` (SHIPPABLE_WITH_CAVEATS 89.0) — the design source; ADRs D1-D5 map to this plan's ADRs.
- cline `LoopDetectionTracker` (`.claude/knowledge-base/references/cline/sdk/packages/core/src/runtime/safety/loop-detection.ts:50`, `:66`, `:113`) — the canonical-signature + counter + soft/hard-threshold + verdict this tracker mirrors; its wiring test (`.claude/knowledge-base/references/cline/sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.test.ts:2140`) is the RED-set template.
- opencode doom-loop (`.claude/knowledge-base/references/opencode/packages/opencode/src/session/processor.ts:35`, `:522`) — the compact inline variant + threshold=3.
- No `*-patterns` skill exists in `skills/` for this domain (verified `ls skills/*-patterns/` empty) — the blueprint is the sole prior-art anchor.

## Objective

- [ ] SG1 — `DoomLoopTracker` pure module: canonical `signatureOf(call)` + `inspect(call)` → verdict `ok|soft|hard` with a message; per-instance state (last name/signature/count); configurable soft/hard thresholds (defaults 3/5).
- [ ] SG2 — wired into `continueOrTerminate`: a per-send tracker inspects each dispatched tool call; a `hard` verdict injects the stop message as the final assistant text, sets `ctx.stoppedByDoomLoop`, and breaks the loop (controlled finish, not error).
- [ ] SG3 — public opt/config: `SendOptions.doomLoop?: { softThreshold?; hardThreshold? } | false` (default on 3/5; `false` disables); plumbed to the loop.
- [ ] SG4 — surfaced terminal: `AgentLoopOutput.stoppedByDoomLoop` → `RunResult.stoppedByDoomLoop`; `classifyRound` returns `"no_progress"` on the doom-loop signal (STOP, don't re-send) in BOTH the stateful and streaming drivers.
- [ ] SG5 — `docs.md` documents the new surface; full integration gate green.

## ADRs

### D1 — Canonical key-sorted-JSON signature (not raw stringify)
**Decision:** the fingerprint is `name + JSON.stringify(sortKeys(input))`.
**Rationale:** cline canonicalizes so reordered-but-identical calls match; opencode's raw `JSON.stringify` is order-sensitive (blueprint D1). Robustness for free; `rules/parsimony-ladder.md` — a tiny pure helper, no lib.
**Rejected alternative:** raw stringify — order-sensitive false-negatives. Rejected.

### D2 — Soft + hard thresholds (nudge then stop)
**Decision:** two thresholds — soft (guidance, continue) + hard (stop). Defaults 3 / 5.
**Rationale:** a nudge gives the model a self-correction window before a hard stop (blueprint D2, cline `LoopDetectionVerdict`). **Rejected alternative:** single hard threshold (opencode) — no self-correction window. Rejected.

### D3 — Typed terminal reusing `no_progress`, NOT a new permission model or a new terminal token
**Decision:** the hard action is a controlled stop that surfaces as the existing `no_progress` terminal (via a distinct `stoppedByDoomLoop` signal + a clear resumable message).
**Rationale:** OUR SDK has no permission subsystem (opencode); `rules/error-handling.md` wants a typed stop with a clear message; reusing `no_progress` (blueprint D5-variant) keeps the public terminal token set unchanged (KISS — one termination concept, two triggers) while `stoppedByDoomLoop` carries the specific reason. **Rejected alternatives:** (a) opencode permission-ask — foreign to our architecture; (b) a brand-new terminal token — a larger public-API change for the same user-visible outcome. Both rejected.

### D4 — Pure injectable tracker plugged into the loop, complementing (not replacing) the empty-round `no_progress`
**Decision:** a pure `DoomLoopTracker` instantiated per-send in the loop context, inspected in `continueOrTerminate`; the empty-round `no_progress` path is untouched.
**Rationale:** Rule 9 (reuse the loop seam) + Rule 12 (one termination home) + `rules/architecture.md` DIP; the two detectors cover DIFFERENT failure modes (model silent vs model stuck repeating). **Rejected alternative:** overload the empty-round detector — muddies the signal + risks regressing the shipped path. Rejected.

### D5 — Default-on, opt-out via config
**Decision:** the guard is ON by default (a safety net); `SendOptions.doomLoop: false` disables it; the object form tunes thresholds.
**Rationale:** a safety net that is off by default never fires when it matters (the P0 hang happened with defaults). Configurable for consumers with legitimately-repeating tools. **Rejected alternative:** off-by-default — defeats the "safety net" purpose. Rejected.

## Drawbacks & Risks

| # | Risk | Severity | Mitigation | Owner |
|---|---|---|---|---|
| R1 | A legitimate workflow that calls the SAME tool with the SAME input N times (e.g. a polling tool) trips the guard | MEDIUM | soft-then-hard (nudge first); default hard threshold 5 (generous); `SendOptions.doomLoop:false` opt-out + per-threshold tuning (D5) | paulo |
| R2 | New public surface (`SendOptions.doomLoop`, `RunResult.stoppedByDoomLoop`) is a forward-compat commitment | MEDIUM | keep it minimal (one optional config + one optional boolean); reuse the `no_progress` terminal (no new token) | paulo |
| R3 | The two continuation drivers (stateful `run-to-completion` + streaming `stream-to-completion`) could diverge on the doom-loop terminal | MEDIUM | both share `classifyRound`; the doom-loop branch lives in the shared function — one home, both drivers covered by tests | paulo |
| R4 | Per-turn multi-call bursts (model emits 2 identical calls in ONE turn) could inflate/deflate the count unexpectedly | LOW | inspect each call in the turn sequentially (cline per-call semantics); a wiring test covers a multi-call turn | paulo |

## Unresolved Questions

(none — every decision is resolved at plan time.) The tracker is per-send (reset each `runAgentLoop`); with hard threshold 5 < default maxIterations 8, a doom loop is caught within a single send, so cross-send persistence is out of scope (YAGNI, D4). This is an ADR-scoped decision, not an open question.

## Dependencies

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | | | The guard is a canonical-JSON signature + an integer counter + a threshold compare — pure TS, no library warranted (`rules/parsimony-ladder.md`; the reference cline tracker is itself dependency-free, blueprint Corner 2). | — |

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| (none new) | | | Uses only the SDK's own internal modules + stdlib `JSON`. |

## Dependency Graph

```
Phase 1 (DoomLoopTracker pure module) ──► Phase 2 (wire into continueOrTerminate + config)
                                                  │
                                                  ▼
                                          Phase 3 (surface terminal: RunResult + classifyRound)
                                                  │
                                                  ▼
                                          Final Phase (Integration Validation + docs)
```
Phase 1 blocks 2 (imports the tracker). Phase 2 blocks 3 (sets the ctx signal 3 reads). Final depends on all.

## Phase 1: `DoomLoopTracker` pure module

### T1.1 — Pure `DoomLoopTracker` (signature + counter + thresholds + verdict)

#### Objective
Implement the pure tracker: canonical `signatureOf({name,input})`, per-instance state, `inspect(call)` → `{ kind: "ok"|"soft"|"hard", message? }`, configurable soft/hard thresholds (defaults 3/5), `reset()`.

#### Why this step (action + reasoning)
Action: create `internal/agent-loop/doom-loop-tracker.ts` with the tracker + a canonical signature helper.
Why now: it is the pure unit both later phases depend on (Dependency Graph); building it first with a full RED set (from cline's tests, Prior Art) means the wiring plugs a proven tracker. Cites ADR D1/D2.

#### Evidence
cline `loop-detection.ts:50` (`toolCallSignature` with `sortKeys`), `:66` (`checkRepeatedToolCall` counter + soft/hard), `:113` (defaults 3/5) define the exact contract.

#### Files to edit
```
packages/sdk/src/internal/agent-loop/doom-loop-tracker.ts — (NEW) the tracker
packages/sdk/tests/doom-loop-tracker.test.ts — (NEW) RED first
```

#### Deep file dependency analysis
- New leaf file; no downstream depends yet (Phase 2 imports it).
- Uses only stdlib `JSON`; `LlmToolCallPart` type (`internal/llm/types.js`) for the call shape.

#### Deep Dives
- Invariants: pure + sync + no I/O (Baseline § boundaries); `signatureOf` canonical (key-sorted, recursion-safe with try-catch fallback like cline `:50`); `inspect` increments on identical `name`+signature else resets to 1; `soft` at `count === softThreshold`, `hard` at `count >= hardThreshold`; never throws.

#### Pseudo-code / Signatures
```ts
export interface DoomLoopVerdict { kind: "ok" | "soft" | "hard"; message?: string }
export interface DoomLoopConfig { softThreshold: number; hardThreshold: number }
export function signatureOf(call: { name: string; input: unknown }): string; // name + canonical JSON
export class DoomLoopTracker {
  constructor(config?: Partial<DoomLoopConfig>);   // defaults soft 3 / hard 5
  inspect(call: { name: string; input: unknown }): DoomLoopVerdict;
  reset(): void;
}
```

#### TDD
```
RED: test_signature_is_canonical_key_order_insensitive — sig({a:1,b:2}) === sig({b:2,a:1})
RED: test_signature_distinguishes_name — same input, different name → different sig
RED: test_signature_distinguishes_input — same name, different input → different sig
RED: test_signature_handles_null_and_primitive_input — null / "s" / 5 do not throw
RED: test_inspect_ok_below_soft — 2 identical calls (soft=3) → kind "ok"
RED: test_inspect_soft_at_threshold — 3rd identical call → kind "soft" with a message
RED: test_inspect_ok_strictly_between_soft_and_hard (EC-1) — 4th identical call (soft=3,hard=5) → kind "ok" (soft fires ONLY at ==softThreshold, so the nudge cannot spam)
RED: test_inspect_hard_at_threshold — 5th identical call → kind "hard" with a stop message
RED: test_signature_treats_undefined_valued_key_as_absent (EC-3) — sig({a:1,b:undefined}) === sig({a:1}) (JSON.stringify drops undefined — intended: an undefined arg is not distinguishing)
RED: test_counter_resets_on_different_call — A,A,B → B resets count to 1 → "ok"
RED: test_counter_resets_on_different_input — read(A),read(A),read(B) → resets
RED: test_reset_clears_state — after reset(), a repeated call starts from 1
RED: test_default_thresholds_are_3_and_5 — no config → soft@3, hard@5
RED: test_custom_thresholds — {softThreshold:2,hardThreshold:3} honored
RED: test_hard_message_names_the_tool_and_count — message mentions the tool name + count
RED: test_never_throws_on_weird_input — circular-safe / symbol input → no throw
GREEN: implement signatureOf (sortKeys + JSON.stringify + try-catch) + the counter/verdict
REFACTOR: extract sortKeys; keep the class < 90 LoC
```

#### Concurrency tests (only when applicable)
(none — single-threaded) a `DoomLoopTracker` instance is owned by one `runAgentLoop` and inspected sequentially per turn; no shared state across concurrent runs.)

#### Failure scenarios
(none — pure in-process computation, no external I/O.)

#### Acceptance Criteria
- `tests/doom-loop-tracker.test.ts` runs ≥ 14 cases and exits 0.
- `test_signature_is_canonical_key_order_insensitive`, `test_inspect_hard_at_threshold`, `test_counter_resets_on_different_call` pass.
- `wc -l doom-loop-tracker.ts` < 90 (per `rules/architecture.md`).

#### DoD
- `pnpm --filter @theokit/sdk exec vitest run tests/doom-loop-tracker.test.ts` exits 0.
- typecheck + biome clean on the new files.

## Phase 2: Wire the tracker into the inner loop

### T2.1 — Inspect tool calls in `continueOrTerminate`; hard verdict → controlled stop

#### Objective
Instantiate a `DoomLoopTracker` per-send (in the loop context), inspect each dispatched tool call in `continueOrTerminate`; on `hard`, inject the stop message as the final assistant text, set `ctx.stoppedByDoomLoop = true`, and break the loop (return a `done`-shaped controlled finish). On `soft`, inject a one-time guidance nudge and continue. Plumb the config (`SendOptions.doomLoop`, default on 3/5; `false` disables) through `AgentLoopInputs`.

#### Why this step (action + reasoning)
Action: add the tracker instance + `stoppedByDoomLoop?` to `LoopContext`; in `continueOrTerminate` after `dispatchTools` (`loop.ts:336`), inspect `llmOutput.toolCalls`; wire `SendOptions.doomLoop` → `AgentLoopInputs.doomLoop` → the tracker.
Why now: this is the behavior change that closes the hang; it depends on Phase 1's tracker. Cites ADR D3/D4/D5.

#### Evidence
`continueOrTerminate` (`loop.ts:323`) dispatches at `:336` and returns continue at `:355`; `llmOutput.toolCalls` (each `{id,name,input}`) is the fingerprint source; `LoopContext.stoppedAtIterationLimit` (`loop-context-init.ts:30`) is the precedent for a ctx stop flag.

#### Files to edit
```
packages/sdk/src/internal/agent-loop/loop.ts — inspect toolCalls in continueOrTerminate; hard → stop, soft → nudge
packages/sdk/src/internal/agent-loop/loop-context-init.ts — add tracker instance + stoppedByDoomLoop? to LoopContext
packages/sdk/src/internal/agent-loop/loop-types.ts — AgentLoopInputs.doomLoop? (config) + AgentLoopOutput.stoppedByDoomLoop?
packages/sdk/tests/agent-loop-doom-loop-wiring.test.ts — (NEW) RED first (fake LLM emitting identical calls)
```

#### Deep file dependency analysis
- `continueOrTerminate` (Baseline row): today dispatches + returns continue. Adding the inspect+stop is additive; the empty-round/iteration-limit paths are untouched (D4).
- `LoopContext` is internal; adding fields is additive. The tracker instance is created in `initLoopContext` (default on unless `doomLoop:false`).
- Multi-call turn (R4): inspect each `toolCalls[i]` sequentially — the first call reaching `hard` stops.

#### Deep Dives
- Invariants: `doomLoop:false` ⇒ tracker never created/inspected ⇒ byte-identical current behavior; a `hard` stop sets `finalStatus` to a controlled finish (NOT `error`), with the stop message as final text; `soft` nudges at most once per streak then continues; the existing iteration-limit + empty-round terminals still fire independently.

#### Pseudo-code / Signatures
```ts
// in continueOrTerminate, after dispatchTools:
for (const call of llmOutput.toolCalls) {
  const v = ctx.doomLoop?.inspect({ name: call.name, input: call.input });
  if (v?.kind === "hard") { ctx.stoppedByDoomLoop = true; await emitAssistantTextStep(inputs, ctx, v.message!); return "done"; }
  if (v?.kind === "soft") { /* inject one-time guidance user message */ }
}
```

#### TDD
```
RED: test_identical_calls_hit_hard_threshold_stops_run — fake LLM emits read_file({p:"a"}) every turn; run stops with stoppedByDoomLoop=true before the iteration ceiling
RED: test_stop_injects_resumable_message — the final assistant text is the doom-loop stop message
RED: test_soft_threshold_injects_nudge_then_continues — at soft count a guidance message is injected, loop continues
RED: test_soft_nudge_fires_once_not_spam (EC-1) — across soft→hard, the guidance message is injected exactly ONCE (relies on the ==softThreshold semantics)
RED: test_different_calls_never_trip_guard — alternating tools never stop (runs to a normal finish/iteration-limit)
RED: test_doomLoop_false_disables_guard — doomLoop:false → identical calls run to the iteration ceiling (current behavior), stoppedByDoomLoop unset
RED: test_custom_thresholds_via_config — doomLoop:{hardThreshold:2} stops after 2 identical
RED: test_multi_call_turn_counts_each_call — one turn emitting two identical calls advances the counter by 2
GREEN: wire the tracker inspect + stop/nudge + config plumbing
REFACTOR: keep continueOrTerminate within its complexity budget (extract a small inspectForDoomLoop helper)
```

#### Concurrency tests (only when applicable)
(none — single-threaded) the tracker is per-send and inspected sequentially. Tool dispatch uses `mapWithConcurrency` but the tracker inspects `llmOutput.toolCalls` sequentially BEFORE/independent of concurrent execution — no shared-state race.)

#### Failure scenarios
(none — no external I/O; the tracker is pure.)

#### Acceptance Criteria
- `test_identical_calls_hit_hard_threshold_stops_run` + `test_doomLoop_false_disables_guard` pass.
- `doomLoop:false` ⇒ existing agent-loop tests unchanged (byte-identical path).
- Soft nudge injected at most once per streak.

#### DoD
- `pnpm --filter @theokit/sdk exec vitest run tests/agent-loop-doom-loop-wiring.test.ts` exits 0.
- Existing `agent-loop-*` + `loop` suites stay green; typecheck + biome clean.

## Phase 3: Surface the terminal to the continuation drivers

### T3.1 — `RunResult.stoppedByDoomLoop` + `classifyRound` returns `no_progress`

#### Objective
Surface `AgentLoopOutput.stoppedByDoomLoop` → `RunResult.stoppedByDoomLoop`; in `classifyRound` (shared by both drivers), a `result.stoppedByDoomLoop === true` returns `"no_progress"` (STOP, don't re-send). Add `SendOptions.doomLoop?` to the public type.

#### Why this step (action + reasoning)
Action: thread `stoppedByDoomLoop` from `AgentLoopOutput` to `RunResult`; add the `classifyRound` branch; add `SendOptions.doomLoop?` + `RunResult.stoppedByDoomLoop?` to `types/run.ts`.
Why now: without this, an inner-loop doom-loop stop would be re-sent by the outer driver (re-triggering the loop). It depends on Phase 2's ctx signal. Cites ADR D3.

#### Evidence
`classifyRound` (`run-to-completion.ts:54`): `stoppedAtIterationLimit !== true → done` (`:60`), empty-round → `no_progress` (`:62`). The doom-loop branch mirrors the empty-round one. `RunResult` (`types/run.ts:53`), `RunToCompletionResult.terminal` (`:138`).

#### Files to edit
```
packages/sdk/src/types/run.ts — SendOptions.doomLoop? + RunResult.stoppedByDoomLoop? (additive)
packages/sdk/src/internal/runtime/lifecycle/run-to-completion.ts — classifyRound: stoppedByDoomLoop → "no_progress"
packages/sdk/src/internal/runtime/local-agent/real-local-run.ts — thread AgentLoopOutput.stoppedByDoomLoop → RunResult (where stoppedAtIterationLimit is already threaded)
packages/sdk/tests/run-to-completion.test.ts — add classifyRound doom-loop cases
```

#### Deep file dependency analysis
- `classifyRound` is shared by `run-to-completion.ts` AND `stream-to-completion.ts` (Baseline § callers) — the single branch covers both drivers (R3).
- `RunResult.stoppedByDoomLoop` follows the exact set-in-loop / read-in-driver path of `stoppedAtIterationLimit` (`real-local-run.ts` threads it).
- `SendOptions.doomLoop` is additive/optional → backward-compatible.

#### Deep Dives
- Invariants: `stoppedByDoomLoop` precedence — a doom-loop stop returns `no_progress` even below `maxRounds` (it is a genuine terminal, not a truncation); the empty-round `no_progress` + `step_limit` + `done` paths are unchanged when the flag is unset.

#### Pseudo-code / Signatures
```ts
// classifyRound — FIRST branch, BEFORE the stoppedAtIterationLimit check (EC-2 precedence):
if (result.stoppedByDoomLoop === true) return "no_progress";
if (result.stoppedAtIterationLimit !== true) return "done";
```

#### TDD
```
RED: test_classifyRound_doom_loop_returns_no_progress — result.stoppedByDoomLoop → "no_progress" (not "done"/"continue")
RED: test_classifyRound_doom_loop_stops_below_maxRounds — stoppedByDoomLoop at round 0 with maxRounds 5 → "no_progress" (no re-send)
RED: test_classifyRound_doom_loop_wins_over_iteration_limit (EC-2) — BOTH stoppedByDoomLoop AND stoppedAtIterationLimit set → "no_progress" (the doom-loop branch precedes the iteration-limit check, so the guard is not defeated when both coincide)
RED: test_classifyRound_empty_round_still_no_progress — the existing empty-round path unchanged
RED: test_classifyRound_iteration_limit_still_continues_or_step_limit — existing paths unchanged
RED: test_runResult_carries_stoppedByDoomLoop — a loop that doom-stopped surfaces the flag on RunResult
GREEN: add the branch + thread the field
REFACTOR: none
```

#### Concurrency tests (only when applicable)
(none — single-threaded) pure decision function.)

#### Failure scenarios
(none — no external I/O.)

#### Acceptance Criteria
- `test_classifyRound_doom_loop_returns_no_progress` + `test_classifyRound_doom_loop_stops_below_maxRounds` pass.
- Existing `run-to-completion` + `stream-to-completion` suites stay green (empty-round/step_limit unchanged).
- `SendOptions.doomLoop?` + `RunResult.stoppedByDoomLoop?` typecheck.

#### DoD
- `pnpm --filter @theokit/sdk exec vitest run tests/run-to-completion.test.ts tests/run-to-completion-wiring.test.ts` exits 0.
- typecheck + biome clean.

## Coverage Matrix

| Requirement / Sub-goal | Task(s) | Blueprint anchor |
|---|---|---|
| SG1 — pure DoomLoopTracker | T1.1 | R1, D1, D2 |
| SG2 — wired into continueOrTerminate (hard stop / soft nudge) | T2.1 | R2/R6, D3, D4 |
| SG3 — public config `SendOptions.doomLoop` | T2.1 + T3.1 | D5 |
| SG4 — surfaced terminal `no_progress` in both drivers | T3.1 | R3, D3 |
| SG5 — docs + integration | Final Phase | (checklist) |
| Canonical signature (no false-negatives) | T1.1 | D1 |
| No new dependency | Dependencies + T1.1 | Corner 2 |
| Complement (not replace) empty-round no_progress | T2.1 + T3.1 | D4 |

**Coverage: 5/5 sub-goals + 3 cross-cutting mapped (100%).**

## Failure scenarios (when I/O external)

(none — the entire plan is pure in-process computation over tool-call metadata. No HTTP/DB/queue/socket is touched by the guard.)

## Global Definition of Done

- [ ] `tests/doom-loop-tracker.test.ts` (≥14) + `tests/agent-loop-doom-loop-wiring.test.ts` (≥7) + new `run-to-completion` cases (≥5) all green (≥ 20 new).
- [ ] `pnpm --filter @theokit/sdk typecheck` clean; biome clean.
- [ ] Existing `agent-loop-*`, `loop`, `run-to-completion`, `stream-to-completion` suites stay green (no regression) — `pnpm --filter @theokit/sdk exec vitest run tests` exits 0.
- [ ] `grep -q "doomLoop" packages/sdk/docs.md` succeeds AND a `@theokit/sdk` changeset file exists (Rule 6).
- [ ] `wc -l` on `doom-loop-tracker.ts` < 90; each touched file < 500.
- [ ] `pnpm --filter @theokit/sdk quality:dead` (knip) reports zero orphan exports under `internal/agent-loop/doom-loop-tracker.ts`.
- [ ] `/code-quality` verdict ∉ {FAIL_HARD, INVALID}; `/review` = READY_TO_MERGE.

## Final Phase: Integration Validation

### T4.1 — Full-chain integration gate + public docs

#### Objective
Prove the guard works end-to-end (a fake-LLM agent run that doom-loops stops with `terminal: "no_progress"`) and document the public surface.

#### Why this step
"Eat your own cooking" — the plan is not done until the full gate is green and the public surface is in `docs.md`.

#### Files to edit
```
packages/sdk/docs.md — document SendOptions.doomLoop + RunResult.stoppedByDoomLoop + the no_progress doom-loop trigger
packages/sdk/CHANGELOG.md (root [Unreleased] Added) + .changeset/* — Added entry (Rule 6, both changelogs per SDK CLAUDE.md)
packages/sdk/tests/agent-loop-doom-loop-wiring.test.ts — an end-to-end case: runToCompletion over a doom-looping fake agent → terminal "no_progress"
```

#### Concurrency tests (only when applicable)
(none — single-threaded)

#### Failure scenarios
(none — no external I/O touched.)

#### TDD
```
RED: test_end_to_end_doom_loop_terminates_no_progress — a fake agent that emits identical tool calls, driven by runToCompletion, terminates with terminal "no_progress" and does not exhaust maxRounds
GREEN: (feature implemented in P1-P3; this is the wiring proof)
```

#### Acceptance Criteria / DoD
- `pnpm --filter @theokit/sdk test` (full suite) exits 0.
- `pnpm --filter @theokit/sdk typecheck && pnpm --filter @theokit/sdk lint` both exit 0.
- `pnpm --filter @theokit/sdk validate` exits 0 (publint/attw/depcruise/bundle-budget).
- `grep -q "doomLoop" packages/sdk/docs.md` succeeds and a `@theokit/sdk` changeset exists; root CHANGELOG `[Unreleased]` has the entry.
- `/code-quality` verdict ∉ {FAIL_HARD, INVALID}; `/review` emits `READY_TO_MERGE`.
