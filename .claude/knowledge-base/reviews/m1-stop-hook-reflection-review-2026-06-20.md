# Review: M1-4 — Fire the `stop` hook + bounded `feedback` re-prompt

**Date:** 2026-06-20
**Slug:** `m1-stop-hook-reflection`
**Commits reviewed:** fb268f9 (fixes in 074a5a2)
**Reviewers:** 5 specialist agents (correctness, test-quality, architecture, cross-validation/wiring, docs/DX)

## Verdict

**READY_TO_MERGE** — after the review-fix round. No BLOCKER at any stage; all HIGH + the actionable MEDIUM correctness findings resolved.

## Per-agent verdicts (initial)

| Agent | Verdict | HIGH |
|---|---|---|
| correctness (loop logic) | READY | 0 (2 MEDIUM: F1 ceiling-skips-hook, F3 deny-ignored-when-feedback-precedes) |
| test-quality | NEEDS_FIXES | 3 (EC-2 half-boundary; finishOrReflect nudge-then-reflect untested; ladder integration untested) |
| architecture (DIP/SRP/reuse) | READY | 0 (genuine HooksExecutor reuse; distinct counters; clean internal test seam; complexity in cap) |
| cross-validation/wiring | READY | 0 (ADRs honored; wiring genuine; no scope creep into M1-5) |
| docs/DX | READY | 0 (2 LOW: "fires once" wording; state exact cap) |

## Findings resolved (commit 074a5a2)

- **MEDIUM F3 (correctness):** `reflectAfterStop` ignored `result.blocked` → a `deny` emitted after a `feedback` hook was silently overridden (order-dependent asymmetry). Now honors `result.blocked` first — deny is authoritative regardless of hook ordering. Test: `test_deny_is_authoritative_even_when_feedback_precedes_it`.
- **MEDIUM F1 (correctness):** the re-prompt ceiling was checked BEFORE firing the hook → at the ceiling the `stop` hook never fired on the run-ending finish (an observer hook missed the terminal). Now the hook ALWAYS fires on a clean finish; the ceiling gates only re-prompting. Test: ceiling test now asserts `run` call count == calls.
- **HIGH (tests):** added `continueOrTerminate`-driven coverage — clean finish fires `stop` + finishes; nudge takes precedence and skips `stop`; the real feedback→continue→clean-finish ladder fires `stop` on each finish (the EC-2 error-terminal test now sits alongside its clean-finish counterpart). Plus a multiple-decisions `find()` test.
- **LOW (docs):** "fires each time" (not "once"), exact cap (2) stated, deny-authoritative note.

Tests: 9 → 14 GREEN.

## Verified strengths (from the reviews)

- Architecture: genuine reuse of the `HooksExecutor` port (no new infra/deps); `nudgeAttempts`/`stopFeedbackAttempts` are distinct concerns (not a DRY violation); `finishOrReflect` is a cohesive SRP extraction; internal-only test seam (no public barrel leak); Biome-confirmed complexity ≤ 10.
- Cross-validation: faithful to ADRs D1-D4; wiring chain genuine (`runAgentLoop`→…→`reflectAfterStop`); commits conventional, on develop, no Co-Authored-By; no scope creep into M1-5.
- Correctness: termination double-bounded (ceiling + iteration budget); `stopFeedbackAttempts` increments only on honored feedback; nudge/reflect never double-fire on one pass.

## Gates

tsc clean · Biome clean (cognitive-complexity ≤ 10) · knip clean · full SDK suite 2720 passed / 0 failed.
