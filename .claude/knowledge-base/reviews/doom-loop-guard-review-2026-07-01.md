# Review — doom-loop-guard

Date: 2026-07-01 · Cycle: REVIEW (cycle-review.md) · Branch: `develop`
Subject diff: `d7057f2^..HEAD` (packages/) — commits d7057f2 (T1.1), 4bafc86 (T2.1+T3.1), 3b41401 (T4.1), edf0014 (NUL fix), + review-round fixes.
Reviewers: 5 independent specialist agents (architecture, correctness, tests, wiring, cross-validation) + self-review.

**Verdict:** READY_TO_MERGE

## Severity matrix (post-fix)

| # | Severity (as filed) | Finding | Disposition |
|---|---|---|---|
| F0 | **BLOCKER** (self-review) | Literal NUL byte (0x00) in `doom-loop-tracker.ts` signature template — git treated source as binary, broke grep/code-search, `file`→"data". Runtime inert (NUL is a valid collision-proof delimiter) so it hid past every test. | **FIXED** `edf0014` — expressed as `\u0000` escape (byte-identical runtime, clean ASCII) + regression test `test_signature_delimiter_is_collision_proof_across_name_input_boundary`. |
| F1 | **HIGH** (consensus: tests, cross-val; MEDIUM: wiring; LOW: arch) | `inspectDoomLoop` (loop.ts) — the seam that sets `ctx.stoppedByDoomLoop`, emits the stop step, injects the soft nudge — had NO executing test. The e2e pre-set the flag on a fixture; the "can't drive the loop without a live LLM" justification was refuted by `strip-think-wiring.test.ts`. Wiring-triad pillar (b) gap; plan T2.1 ACs named these loop-level tests. | **FIXED** — new `tests/internal/agent-loop/doom-loop-loop-wiring.test.ts` drives `runAgentLoop` with a mock LLM emitting identical tool calls + a succeeding custom tool: proves `stoppedByDoomLoop===true`, resumable stop message names the tool, custom threshold, and `doomLoop:false` runs to ceiling. 4 tests. |
| F2 | **MEDIUM** (correctness LOW, tests 2×MEDIUM) | No boundary validation of `doomLoop` thresholds: `{hardThreshold:0}`/negative → stop on turn 1; non-integer/NaN → guard silently never fires. Violates fail-fast (error-handling.md). | **FIXED** — `assertValidThresholds` in the tracker constructor throws typed `ConfigurationError` (code `invalid_doom_loop_threshold`) on non-positive-integer thresholds. 3 negative-case tests. `soft>=hard` is NOT rejected (correctness agent confirmed it is safe — hard wins; and it keeps `{hardThreshold:N}` ergonomic) — pinned by `test_soft_ge_hard_suppresses_nudge_and_still_hard_stops`. |
| F3 | **MEDIUM** (wiring) | Observability pillar (c): a doom-loop stop reports `finalStatus:"finished"` with no span attribute/log — invisible in OTel traces vs a clean finish. | **FIXED** — `sendSpan?.setAttribute("stoppedByDoomLoop", true)` in `runAgentLoop` when the guard fires. |
| F4 | **MEDIUM** (cross-val: LoC; arch: docs) | Honesty: implementation summary claimed "90 LoC" but file was 120 (now 143 with fixes); soft nudge (an injected user turn) + default-ON behavior not fully documented. | **FIXED** — summary LoC corrected with rationale; docs.md notes the soft nudge is an injected user message, the default-ON behavior change, and threshold `ConfigurationError`; CHANGELOG `### Changed` entry added for the default-ON behavior change. |
| — | LOW/INFO (accepted) | Array-order / nested-key canonicalization tests missing (added `test_signature_is_array_order_sensitive`, `test_signature_canonicalizes_nested_object_key_order`); primitive cross-type signature aliasing (negligible on the parsed-JSON input domain — only biases toward stopping, never corruption); two consecutive user turns on soft (mirrors the pre-existing stop-feedback nudge, providers coalesce); dead `?? "null"` branch (harmless); public/internal type-shape duplication `DoomLoopThresholds` vs `Partial<DoomLoopConfig>` (defensible decoupling). | No blocker; documented. |

## Confirmed-correct (independent verification)

- **EC-1** (soft fires only at `==softThreshold`, cannot spam) — CONFIRMED by correctness agent with a count trace + `test_inspect_ok_strictly_between_soft_and_hard`.
- **EC-2** (`classifyRound` doom-loop branch precedes iteration-limit) — CONFIRMED with `test_classifyRound_doom_loop_wins_over_iteration_limit`; also proved the two flags cannot both legitimately arise (a hard verdict returns `done`, never entering the `continue` branch that sets `stoppedAtIterationLimit`).
- **Concurrency** — tracker is per-run instance-private state (`#config`/`#lastSignature`/`#count`); `DEFAULT_CONFIG` is read-only. No shared mutable state across concurrent runs.
- **Wiring triad** — (a) caller path `Agent.send → real-local-run → runAgentLoop → continueOrTerminate → inspectDoomLoop` traced end-to-end; (b) integration test at the driver boundary + the new loop-driven test; (c) `RunResult.stoppedByDoomLoop` surfaced through `fixture-run-base.ts` `applyScriptMetrics` + span attribute.
- **Plan fidelity** — every task T1.1–T4.1 and every Coverage-Matrix row maps to committed code + tests; no scope creep; both MUST-FIX edge cases implemented and pinned.
- **Gates** — knip exit 0 (no orphan export); depcruise 0 violations; typecheck + biome clean; `pnpm validate` green.

## Hard gates (cycle-review.md)

- No failing tests on the branch · No secrets committed · No direct commit to `main` (on `develop`) · No Co-Authored-By trailer · CHANGELOG updated. All PASS.

## Outcome

No BLOCKER and no unresolved HIGH remain (the single HIGH was fixed with the loop-driven wiring test). All 5 agents' actionable findings are either fixed or accepted with rationale. **READY_TO_MERGE.**
