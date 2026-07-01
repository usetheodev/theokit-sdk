# Blueprint: Doom-loop / no-progress guard for the `@theokit/sdk` agent loop

> **Discovery verdict:** SHIPPABLE_WITH_CAVEATS (89.0, 2026-07-01 — 5/5 citations verified, 100/100/100 substance; density soft-floor for a focused 2-reference study) · **Slug:** `doom-loop-guard` · **Date:** 2026-07-01
>
> How opencode and cline detect-and-stop a **doom loop** (the model repeating IDENTICAL tool calls that make no progress), synthesized into a design for a typed early-stop guard plugged into the SDK's existing pluggable iteration-tracker seam — complementing (not replacing) the empty-round `no_progress`. Would have converted the P0 `\n`-path hang (`read_file` → `not_found`, retried identically) into a typed stop.

## Context

The SDK inner loop (`packages/sdk/src/internal/agent-loop/loop.ts:50` `while (budget.shouldContinue())`) has a pluggable iteration-tracker that denies an iteration with a `decision.reason`, and the outer driver (`packages/sdk/src/internal/runtime/lifecycle/run-to-completion.ts:62`) has a `no_progress` terminal — but that terminal fires ONLY on **empty rounds** (`isEmptyRound(result) && emptyStreak >= 1`). The P0 hang produced NON-empty rounds (repeated `read_file`), so nothing fired and the loop ground to the ceiling. The gap: **no identical-repeat-tool-call detection.** This blueprint studies the two references that solve exactly this, to design a guard that plugs into OUR tracker seam (Rule 9 — reuse the seam; Rule 12 — one termination home) and emits a typed terminal (`rules/error-handling.md` — never a silent hang), unit-testable as a pure state machine (`rules/testing.md`), a pure injectable domain tracker (`rules/architecture.md` DIP).

## Objective

Decide the fingerprint, thresholds, typed action, and insertion seam of a doom-loop guard for the SDK inner loop.

- [x] All research questions answered with citations to `.claude/knowledge-base/references/`
- [x] Cross-cutting comparison table populated for every in-scope reference project
- [x] Recommendations section provides ≥1 concrete decision proposal per research question
- [x] `/discover-confidence` verdict = SHIPPABLE_WITH_CAVEATS (89.0)

## Coverage Corner 1 — Integration Tests

How cline tests the guard — the RED-set template for OUR TDD (Q4).

`.claude/knowledge-base/references/cline/sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.test.ts` wires the trackers into the runtime and asserts abort behavior:

| Scenario | Line | Arrange | Assertion → OUR RED |
|---|---|---|---|
| "aborts on hard-threshold loop detection of identical tool calls" | `:2140` | 3 identical `tool-started` events (`toolName:"same"`, `input:{a:1}`) + config `loopDetection:{softThreshold:2, hardThreshold:3}` | `abortCalls.length >= 1` — the hard threshold stops the run. **THE doom-loop test.** |
| "aborts after maxConsecutiveMistakes failed-tool turns" | `:2080` | `maxConsecutiveMistakes:2`; first failed turn → no abort, second → abort | counter reaches limit → abort (the mistake-escalation path) |
| "resets mistake tracking when run() starts a fresh conversation" | `:2126` | two separate `run()`s of failed turns | no abort — a fresh conversation resets the counter |

Take-away: the RED set is **(a)** N identical calls (same name + same canonical input) at the hard threshold → typed stop; **(b)** the counter resets on a different call / a fresh run. Fake calls are shaped as `{ toolName, input }` — trivial to construct.

## Coverage Corner 2 — Dependencies

Is the guard dependency-free? (Q5 — informs `rules/parsimony-ladder.md`.)

Both cline trackers are **pure TS state machines with zero runtime dependency**: `.claude/knowledge-base/references/cline/sdk/packages/core/src/runtime/safety/loop-detection.ts` imports only `import type { LoopDetectionConfig }` (type-only, erased), and `mistake-tracker.ts` imports only `type` symbols from `@cline/shared`. The `.claude/knowledge-base/references/cline/sdk/packages/core/package.json` deps (otel, mcp) are the runtime's, NOT the trackers'.

**Verdict for our design:** the doom-loop guard is pure TS — **no new dependency** (unlike the sanitization cycle's `jsonrepair`). A canonical-JSON signature + an integer counter; nothing to import.

## Coverage Corner 3 — Tools

WHERE the guard lives + how the verdict is wired to a stop (Q6 — informs OUR insertion seam).

- **cline ships it ISOLATED + INJECTED** — `.claude/knowledge-base/references/cline/sdk/packages/core/src/runtime/safety/loop-detection.ts:125` is a `LoopDetectionTracker` class the `SessionRuntime` owns and installs as a **`beforeTool` hook** (`loop-detection.ts:121`) that calls `inspect()` (`:136`) → returns `{skip, stop, reason}`. Pure module, injected — the runtime decides the action from the verdict.
- **opencode ships it INLINE** — `.claude/knowledge-base/references/opencode/packages/opencode/src/session/processor.ts:522` checks the last-N parts inside the processor and asks a permission (`:539`), gated by `continue_loop_on_deny` (`:966`).

**Verdict for our design:** cline's isolated-injected model maps DIRECTLY to OUR pluggable iteration-tracker seam (`loop.ts:50` `budget.shouldContinue()` / `decision.reason`, the same seam the shipped step-cap/counter tracker uses). OUR guard = a pure `DoomLoopTracker` module inspected per tool call in the loop/tool-dispatch, its hard verdict denying the iteration with a typed reason. Tested in vitest as a pure unit + a loop integration test.

## Coverage Corner 4 — Techniques

The algorithm to borrow (Q1 opencode, Q2 cline loop-detection, Q3 cline mistake escalation).

### T1 — Canonical tool-call signature + consecutive-identical counter (cline, Q2)

`.claude/knowledge-base/references/cline/sdk/packages/core/src/runtime/safety/loop-detection.ts`:
- **Signature** `toolCallSignature(input)` (`:50`): `null`→`"null"`, string→itself, primitive→`String()`, object→`JSON.stringify(sortKeys(input))` with a try-catch fallback. `sortKeys` recursively key-sorts, so `{a:1,b:2}` and `{b:2,a:1}` yield the SAME signature — **canonical**, more robust than opencode's raw order-sensitive `JSON.stringify` (Q1, `processor.ts:531`).
- **State** `LoopDetectionState` (`:20`): `lastToolName`, `lastToolSignature`, `consecutiveIdenticalCount`.
- **Check** `checkRepeatedToolCall` (`:66`): if `toolName === lastToolName && signature === lastToolSignature` → increment, else reset to 1; returns `{ softWarning: count === softThreshold, hardEscalation: count >= hardThreshold }`.
- **Verdict** `LoopDetectionVerdict` (`:102`): `ok | soft | hard` with a `message`. Defaults `softThreshold:3`, `hardThreshold:5` (`loop-detection.ts:113`). The `inspect()` method (`:136`) turns the check into the verdict with a human-readable message ("Detected N consecutive identical calls to `X`; stopping to avoid a loop.").

### T2 — opencode's compact inline variant (Q1)

`.claude/knowledge-base/references/opencode/packages/opencode/src/session/processor.ts`: `DOOM_LOOP_THRESHOLD = 3` (`:35`); `recentParts = parts.slice(-DOOM_LOOP_THRESHOLD)` (`:522`); fire only if all N recent parts are `tool` + same `name` + non-`pending` + `JSON.stringify(part.state.input) === JSON.stringify(input)` (`:531`). Action = permission ask `"doom_loop"` (`:539`), gated by `continue_loop_on_deny` (`:966`).

**Scope note (EC-3):** opencode's ACTION is a permission-ask routed through its permission subsystem, which OUR SDK does not have. We borrow the **fingerprint + window + threshold + break-decision technique**, NOT the permission model; OUR action is a typed terminal (T3).

### T3 — Typed stop outcome + forceAtLimit escalation (cline mistake-tracker, Q3)

`.claude/knowledge-base/references/cline/sdk/packages/core/src/runtime/safety/mistake-tracker.ts` shows the TYPED action shape to emulate: `MistakeOutcome` (`:52`) = `{action:"continue", guidance?}` | `{action:"stop", message, reason?}`. `record()` (`:82`) increments, and at the limit resolves via `resolveConsecutiveMistakeDecision` (`:190`) to a stop with `buildMistakeLimitStopMessage` (`:157`) — a clear, resumable message ("Stopped after N/M... Session state was preserved. Send a new prompt to resume."). Crucially, `forceAtLimit` (`:49`, applied at `:84`) lets a HARD loop-detection verdict short-circuit straight to the stop limit — the bridge from LoopDetection-hard → MistakeTracker-stop.

**Take-away:** soft verdict → a guidance nudge (continue); hard verdict → a typed STOP with a resumable message. This is the cross-model convergent action (cline explicit; opencode's break is the coarse equivalent).

## Cross-cutting comparison table

| Dimension | opencode | cline | → OUR guard |
|---|---|---|---|
| signature | raw `JSON.stringify(input)` (order-sensitive) `:531` | canonical `JSON.stringify(sortKeys(input))` `:50` | **canonical (cline)** — robust to key order |
| window | last-N parts `slice(-3)` `:522` | running `consecutiveIdenticalCount` `:66` | **running counter (cline)** — simpler, no history slice |
| thresholds | single (=3) `:35` | soft(3) + hard(5) `:113` | **soft + hard** (nudge then stop) |
| action | permission ask `:539` | typed `MistakeOutcome` stop/continue `:52` | **typed terminal/reason** (NOT permission) |
| isolation | inline in processor | pure injected module + `beforeTool` hook `:121` | **pure tracker, plugged into loop.ts seam** |
| deps | inline | dependency-free (type-only import) | **dependency-free** |
| stop message | n/a | resumable `buildMistakeLimitStopMessage` `:157` | **clear resumable reason** |

## Recommendations

1. **Ship a pure `DoomLoopTracker`** (internal module) with cline's canonical `toolCallSignature` (key-sorted JSON) + a `consecutiveIdenticalCount` + soft/hard thresholds, returning a typed verdict `ok | soft | hard`. Dependency-free. — answers Q2/Q5.
2. **Plug it into the existing pluggable iteration-tracker seam** (`loop.ts:50` `budget.shouldContinue()`/`decision.reason`) — inspect each dispatched tool call's signature; a HARD verdict denies the next iteration with a typed reason. Reuses OUR shipped tracker abstraction (Rule 9). — answers Q6.
3. **Emit a typed terminal** — complement the empty-round `no_progress` (`run-to-completion.ts:62`) with an identical-repeat terminal (name it, e.g. `"repeated_tool_calls"`, or reuse `no_progress` with a distinct reason) carrying a clear, resumable message (cline `buildMistakeLimitStopMessage` shape). NOT opencode's permission model (EC-3). — answers Q1/Q3.
4. **Soft threshold = a guidance nudge** injected into the conversation ("you've called X identically N times; try a different approach"), continuing; **hard threshold = stop**. Defaults soft 3 / hard 5 (cline), configurable. — answers Q3.
5. **Reset the counter** on a different tool call and on a fresh run/round (cline test `:2126`). — answers Q4.
6. **TDD RED set** from cline's tests: N identical calls at hard threshold → typed stop; counter resets on a different call. Pure-unit + loop-integration. — answers Q4.

## ADRs

### D1 — Canonical key-sorted-JSON signature (not raw stringify)
**Decision:** the fingerprint is `toolName + JSON.stringify(sortKeys(input))`.
**Rationale:** cline (`loop-detection.ts:50`) canonicalizes so `{a:1,b:2}` == `{b:2,a:1}`; opencode's raw `JSON.stringify` (`processor.ts:531`) is order-sensitive and misses reordered-but-identical calls. Robustness for free. **Rejected alternative:** raw stringify — order-sensitive false-negatives. Rejected.

### D2 — Soft + hard thresholds (nudge then stop), not a single threshold
**Decision:** two thresholds — soft (guidance, continue) and hard (typed stop). Defaults 3 / 5 (cline), configurable.
**Rationale:** a nudge gives the model a chance to self-correct before a hard stop (cline `LoopDetectionVerdict` `:102` + `MistakeOutcome` `:52`); a single threshold (opencode `:35`) is coarser. **Rejected alternative:** single hard threshold — no self-correction window. Rejected.

### D3 — Typed terminal/reason, NOT a permission model
**Decision:** the hard action is a typed loop terminal/reason with a clear resumable message, plugged into OUR loop seam.
**Rationale:** OUR SDK has no permission subsystem (opencode `:539`); `rules/error-handling.md` wants a typed stop, never a silent hang; cline's `MistakeOutcome` stop (`:52`) + `buildMistakeLimitStopMessage` (`:157`) is the right shape. **Rejected alternative:** opencode permission-ask — foreign to OUR architecture. Rejected.

### D4 — Pure injectable tracker plugged into the existing iteration-tracker seam
**Decision:** a pure `DoomLoopTracker` module, injected/plugged via the existing `loop.ts` pluggable-tracker abstraction (the same seam as the shipped counter/step-cap tracker).
**Rationale:** Rule 9 (reuse the seam, don't reinvent) + `rules/architecture.md` DIP; cline ships it exactly so (`loop-detection.ts:125` class + `beforeTool` hook `:121`). **Rejected alternative:** inline in the loop body (opencode style) — not unit-testable in isolation, not injectable. Rejected.

### D5 — Complement the empty-round `no_progress`, do not replace it
**Decision:** the identical-repeat terminal is a SIBLING of the existing empty-round `no_progress` (`run-to-completion.ts:62`).
**Rationale:** they cover DIFFERENT failure modes (model went silent vs model stuck repeating); Rule 12 (one termination home, two reasons). **Rejected alternative:** overload `no_progress` to also mean identical-repeat — muddies the signal + risks regressing the empty-round path. Rejected (though reusing the token WITH a distinct reason is an acceptable variant the plan will decide).

## Blocked questions (if any)

None — all 6 research questions answered with verified citations.
