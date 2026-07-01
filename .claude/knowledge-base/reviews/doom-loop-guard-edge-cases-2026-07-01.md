# Edge Case Review — doom-loop-guard

Date: 2026-07-01
Tasks analyzed: 4 (T1.1, T2.1, T3.1, T4.1)
Cases found: 4 (EDGE: 2, NEGATIVE: 2 | MUST FIX: 2, SHOULD TEST: 1, DOCUMENT: 1)

## MUST FIX

### EC-1: the soft nudge must fire EXACTLY ONCE per streak (no nudge spam)
- **Affected task:** T2.1
- **Kind:** NEGATIVE
- **Family:** State
- **Scenario:** if `inspect` returned "soft" for every count `>= softThreshold`, the loop would inject a guidance message on EVERY identical call between the soft and hard thresholds — spamming the conversation.
- **Impact:** a noisy, degraded run (and wasted tokens) between soft and hard.
- **Suggested fix:** `inspect` returns `soft` ONLY at `count === softThreshold` (exact, per cline `loop-detection.ts:84` `softWarning: count === softThreshold`); counts strictly between soft and hard return `ok`. Add `test_soft_fires_once_then_ok_until_hard` asserting a single nudge injection.

### EC-2: classifyRound must check `stoppedByDoomLoop` BEFORE `stoppedAtIterationLimit`
- **Affected task:** T3.1
- **Kind:** NEGATIVE
- **Family:** Boundary
- **Scenario:** a run that doom-loops AND happens to also be flagged `stoppedAtIterationLimit` (e.g. the hard threshold equals the iteration ceiling). If the iteration-limit check runs first, the run is classified as a truncation (`step_limit`/continue) and RE-SENT — re-triggering the doom loop.
- **Impact:** the guard is defeated when both flags coincide — the exact hang it fixes.
- **Suggested fix:** in `classifyRound`, the `stoppedByDoomLoop === true → "no_progress"` branch MUST precede the `stoppedAtIterationLimit` check. Add `test_classifyRound_doom_loop_wins_over_iteration_limit` (both flags set → "no_progress").

## SHOULD TEST

### EC-3: signature of inputs differing only by an `undefined`-valued key
- **Affected task:** T1.1
- **Kind:** EDGE
- **Suggested test:** `test_signature_treats_undefined_valued_key_as_absent` — `sig({a:1,b:undefined})` vs `sig({a:1})`: `JSON.stringify` drops `undefined`, so both are the SAME signature. Assert this is the intended behavior (an `undefined` arg is not a distinguishing input) — pins the contract so a future `signatureOf` change can't silently regress it.

## DOCUMENT

### EC-4: a legitimately-repeating tool (poll / wait / retry) trips the guard
- **Kind:** NEGATIVE
- **Accepted risk:** already captured as Drawbacks R1 — mitigated by soft-then-hard (nudge first), a generous default hard threshold (5), and `SendOptions.doomLoop:false` / per-threshold tuning (ADR D5). A tool that must be called identically ≥5 times in a row is rare; the opt-out is the escape hatch. No plan change beyond R1.

## Summary

| Task | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|------|------|----------|----------|-------------|----------|
| T1.1 | 1 | 0 | 0 | 1 | 0 |
| T2.1 | 0 | 1 | 1 | 0 | 1 |
| T3.1 | 1 | 1 | 1 | 0 | 0 |
| T4.1 | 0 | 0 | 0 | 0 | 0 |

**Coverage check:** T1.1/T2.1/T3.1 (the real logic boundaries) each carry both lenses; T4.1 is validation.

**Verdict:** PLAN NEEDS ADJUSTMENT (2 MUST FIX absorbed into v1.1)
