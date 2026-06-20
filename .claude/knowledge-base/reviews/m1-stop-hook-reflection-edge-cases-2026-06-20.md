# Edge Case Review — m1-stop-hook-reflection

Date: 2026-06-20
Tasks analyzed: 2 (T1.1 dispatch+reflect, T2.1 docs/changelog)
Edge cases found: 4 (MUST FIX: 0, SHOULD TEST: 2, DOCUMENT: 2)

Confirmed against code: `HookDecision` has `decision` + `feedback?` (`hooks-executor.ts:28-32`); `run()` short-circuits on `deny` but `decisions` still includes it (→ no feedback → finish); a `"continue"` from `reflectAfterStop` is additionally gated by `while (budget.shouldContinue())` (`loop.ts:47`).

## MUST FIX

(none — no crash / data-loss / security path. The ceiling (D3) + the budget gate together prevent runaway reflection.)

## SHOULD TEST

### EC-1: the ceiling must count FEEDBACK re-prompts, not stop-fires
- **Affected task:** T1.1
- **Suggested test:** `test_stopFeedbackAttempts_increments_only_on_feedback` — `reflectAfterStop` increments `ctx.stopFeedbackAttempts` ONLY when a feedback decision is honored; an `allow`/`deny`/no-hook result leaves it at 0 (so a long run with many clean finishes but no feedback never exhausts the ceiling).

### EC-2: the "stop not fired on error terminal" test must exercise continueOrTerminate ROUTING, not the pure helper
- **Affected task:** T1.1
- **Suggested test:** `test_stop_not_fired_on_error_terminal` MUST drive the error path of `continueOrTerminate` (an errored `llmOutput` returns `"error"` at `loop.ts:270` BEFORE the clean-finish branch) and assert `inputs.hooks.run` was NEVER called with `event:"stop"`. Testing only `reflectAfterStop` in isolation would vacuously "pass" (the helper is never reached on error) and would NOT prove the D1 invariant. Use a spy on `inputs.hooks.run`.

## DOCUMENT

### EC-3: the feedback re-prompt is additionally bounded by the iteration budget
- **Accepted risk:** when `reflectAfterStop` returns `"continue"`, the loop re-enters `while (budget.shouldContinue())` (`loop.ts:47`). If the budget is already exhausted, the re-prompt is dropped — the pushed `user` message is left unanswered in `ctx.messages` (harmless; the run finishes). So reflection is bounded by BOTH `MAX_STOP_FEEDBACK_ATTEMPTS` AND the iteration budget — defense in depth, no fix needed. Document in the plan Drawbacks.

### EC-4: `reflectAfterStop` does not itself check the abort signal
- **Accepted risk:** like `shouldNudgeAndContinue`, `reflectAfterStop` does not consult the abort signal; an in-flight abort is honored at the NEXT loop iteration's budget/gate check (`loop.ts:47-65`), not mid-reflection. Consistent with the existing nudge precedent. Document; no fix.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 4 | 0 | 2 | 2 |
| T2.1 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN OK (no MUST FIX; fold 2 SHOULD TEST into T1.1 TDD + 2 DOCUMENT into Drawbacks)
