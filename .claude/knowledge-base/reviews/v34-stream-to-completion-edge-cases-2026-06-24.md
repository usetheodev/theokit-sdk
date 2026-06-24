# Edge Case Review — v34-stream-to-completion

Date: 2026-06-24 · Tasks: 2 (T1.1, T2.1) · Edge cases: 3 (MUST FIX: 1, SHOULD TEST: 1, DOCUMENT: 1)

## MUST FIX

### EC-1: the StreamToCompletionResult return value is invisible to `for await...of`
- **Affected task:** T2.1
- **Family:** Format / DX contract
- **Scenario:** `streamToCompletion` returns `AsyncGenerator<SDKMessage, StreamToCompletionResult>`. JS `for await (const m of gen)` consumes the YIELDED values but DISCARDS the generator's RETURN value — so a caller using the idiomatic for-await silently loses `terminal`/`rounds`/`usage`. The theocode reference proves the correct pattern: `headless-runner.ts:96-106` drives it with a manual `gen.next()` loop and reads `res.value` when `res.done`.
- **Impact:** Consumers can't get the terminal/usage without the manual-next idiom; a naive for-await loop looks correct but drops the result.
- **Suggested fix:** Add `test_stream_to_completion_return_value_via_manual_next` (drive with `while(!res.done) res = await gen.next()`; assert `res.value` is the `StreamToCompletionResult`). Document the manual-next consumption pattern in docs.md (mirror the theocode headless-runner idiom). 1 test + 1 doc paragraph.

## SHOULD TEST

### EC-2: early break (caller stops draining) must not leak the in-flight round
- **Affected task:** T2.1
- **Suggested test:** `test_stream_to_completion_early_break_cleanup` — caller `break`s after the first yielded msg; assert the generator's `finally`/return path runs (no further `send` for the next round; the in-flight `run` is not re-entered). Guards against a leaked round when the consumer abandons the stream (JS calls `gen.return()` on break → any cleanup in a `finally` runs).

## DOCUMENT

### EC-3: maxRounds=0 / single-round boundary
- **Affected task:** T2.1
- **Accepted risk:** `maxRounds` is the continuation ceiling; round 0 (the initial send) always runs. With `maxRounds=0`, a truncated round 0 immediately hits `step_limit` (round >= maxRounds → 0>=0). This matches `runToCompletion` semantics (same `classifyRound`) — documented, no special-case needed.

**Verdict:** PLAN NEEDS ADJUSTMENT (1 MUST FIX — return-value consumption test+doc; 1 SHOULD TEST — early-break cleanup; absorb into v1.1.)
