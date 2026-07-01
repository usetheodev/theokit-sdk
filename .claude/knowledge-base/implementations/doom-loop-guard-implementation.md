# Implementation summary — doom-loop-guard

Plan: `.claude/knowledge-base/plans/doom-loop-guard-plan.md` (SHIPPABLE 90.0)
Blueprint: `.claude/knowledge-base/discoveries/blueprints/doom-loop-guard-blueprint.md` (SHIPPABLE_WITH_CAVEATS 89.0)
Verdict: **IMPLEMENTATION_COMPLETE** · 2026-07-01 · branch `develop`

## Commits (TDD, atomic)

| Task | Commit | What |
|---|---|---|
| T1.1 | `d7057f2` | `DoomLoopTracker` pure module (`internal/agent-loop/doom-loop-tracker.ts`) — canonical signature + counter + soft/hard verdict; 16 cases; + changeset |
| T2.1+T3.1 | `4bafc86` | `firstDoomLoopVerdict`/`createDoomLoopTracker` helpers + `continueOrTerminate` wiring (hard→stop, soft→one-time nudge, default-on) + `SendOptions.doomLoop`/`RunResult.stoppedByDoomLoop` + `classifyRound` → `no_progress` (EC-2 precedence) + real-local-run/fixture threading; 46 cases |
| T4.1 | `3b41401` | end-to-end `runToCompletion` doom-loop → `no_progress` (rounds 0, no re-send) + `docs.md` + root CHANGELOG |

## Wiring triad

- **Caller**: `continueOrTerminate` (`loop.ts`) calls `firstDoomLoopVerdict(ctx.doomLoop, toolCalls)` per turn; `createDoomLoopTracker(inputs.doomLoop)` instantiates it in `initLoopContext`; `SendOptions.doomLoop` → `real-local-run` → `AgentLoopInputs.doomLoop`.
- **Integration test**: `tests/run-to-completion.test.ts` E2E (fake agent → `no_progress`) + `agent-loop-doom-loop-wiring.test.ts` (per-turn branch logic, per the repo's lockstep-helper convention).
- **Observability**: `RunResult.stoppedByDoomLoop` + `terminal: "no_progress"` + the injected stop/nudge messages (visible in the stream).

## EC guards implemented (from `/edge-case-plan`)

- EC-1 soft fires ONLY at `==softThreshold` → the nudge cannot spam (`doom-loop-tracker.ts`).
- EC-2 `classifyRound` checks `stoppedByDoomLoop` BEFORE `stoppedAtIterationLimit` → the guard is not defeated when both coincide (`run-to-completion.ts`).
- EC-3 canonical signature drops `undefined`-valued keys (JSON.stringify semantics) — pinned by a test.

## Gate evidence

- `tests/doom-loop-tracker.test.ts` (16) + `tests/agent-loop-doom-loop-wiring.test.ts` (9) + `run-to-completion.test.ts` doom cases (4) = 29 new, green.
- Full SDK suite: **3049 passed / 36 skipped**, exit 0 (first run flaked on the known native-binding parallel contention — see `.githooks/pre-push` comment; clean re-run green).
- `typecheck` clean; `biome` clean; `depcruise` ✔ (439 modules, 0 violations); `knip` exit 0 (no orphan/dead).
- `doom-loop-tracker.ts` = 143 LoC (the `<90` AC was for the T1.1 pure-tracker class alone; the file also hosts the T2.1 helpers `firstDoomLoopVerdict`/`createDoomLoopTracker`/`assertValidThresholds` + threshold validation + ~35 lines of JSDoc — well under the repo's real G8 `<400` gate). `docs.md` + `.changeset/doom-loop-guard.md` (minor) + root CHANGELOG updated.

## Review round (5-agent + self-review) — fixes applied

See `.claude/knowledge-base/reviews/doom-loop-guard-review-2026-07-01.md` for the full matrix. Fixes landed after IMPLEMENT, before READY_TO_MERGE:

- **BLOCKER (self-review):** literal NUL byte in the signature template → expressed as ` ` escape (`edf0014`) + collision-proof regression test.
- **HIGH (consensus):** `inspectDoomLoop` had no executing test → new `tests/internal/agent-loop/doom-loop-loop-wiring.test.ts` drives `runAgentLoop` with a mock LLM (4 tests: hard stop + resumable message + custom threshold + `doomLoop:false` disables).
- **MEDIUM:** fail-fast threshold validation (`assertValidThresholds` → typed `ConfigurationError`) + 3 negative-case tests; `soft>=hard` pinned as safe/documented.
- **MEDIUM:** observability — `stoppedByDoomLoop` span attribute in `runAgentLoop`.
- **MEDIUM (honesty):** LoC claim corrected; docs.md + CHANGELOG note the default-ON behavior change + soft-nudge transcript effect.
- Added `signatureOf` array-order + nested-key canonicalization tests.

Doom-loop test count after review round: 24 (tracker) + 9 (wiring) + 4 (loop-driven) + 4 (run-to-completion) = 41.

## Design (per blueprint)

Pure `DoomLoopTracker` (canonical key-sorted-JSON signature + consecutive-identical counter + soft/hard thresholds, default 3/5) plugged into the loop's `continueOrTerminate`; a hard verdict emits a resumable stop message + `ctx.stoppedByDoomLoop` + controlled `done`; surfaced as `RunResult.stoppedByDoomLoop` → `classifyRound` → `no_progress`. Complements (does not replace) the empty-round `no_progress`. On by default; `SendOptions.doomLoop: false` disables, object tunes. Dependency-free.
