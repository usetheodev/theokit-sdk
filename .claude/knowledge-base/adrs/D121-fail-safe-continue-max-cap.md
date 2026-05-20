# D121 — Fail-safe `continue` on parse error + max-consecutive-failures cap

**Date:** 2026-05-19
**Status:** Accepted

## Decision

When the judge model returns a malformed response (not matching `DONE:`,
`CONTINUE:`, `SKIPPED:`), `parseVerdict` returns
`{ verdict: "continue", parseFailed: true }` — the loop does NOT stop
prematurely.

`runUntilImpl` counts consecutive `parseFailed` responses. When the
count reaches `GoalOptions.maxConsecutiveJudgeFailures` (default 3), the
loop yields `status_change: failed` and returns with reason "judge model
too unreliable".

## Rationale

Stopping prematurely is worse than burning extra turns. If the judge
flakes once on turn 3 and recovers on turn 4, the loop must continue.
But if the judge flakes 3 times in a row, the judge is broken — bail.

3 is the empirical cap from Hermes. Lower values (1, 2) over-fire on
transient parse hiccups; higher values (5+) waste real-LLM budget.

## Consequences

- **Enables:** graceful degradation when the judge model is weak (Haiku,
  Gemini Flash, GPT-3.5). Single parse error doesn't kill the loop.
- **Constrains:** users with even weaker judges (untrained models) may
  need to bump `maxConsecutiveJudgeFailures` or switch to a stronger
  judge via `judgeModel` override.
