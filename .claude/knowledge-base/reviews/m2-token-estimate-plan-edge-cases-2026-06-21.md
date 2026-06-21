# Edge Case Review — m2-token-estimate (PLAN cycle)

Date: 2026-06-21
Plan analyzed: knowledge-base/plans/m2-token-estimate-plan.md
Tasks: 2 (T1.1 helpers, T2.1 doc/wire). Edge cases: 2 (MUST FIX 0, SHOULD TEST 1, DOCUMENT 1)

## MUST FIX
(none — pure total functions; threshold + empty handled in ADR D1/D2 + T1.1 TDD.)

## SHOULD TEST
### EC-1: estimateTokens of whitespace-only / very short text rounds up via ceil
- **Affected task:** T1.1
- **Scenario:** `estimateTokens(" ")` (1 char) → ceil(0.25) === 1; `estimateTokens("ab")` → ceil(0.5) === 1. The ceil means any non-empty text estimates ≥ 1 token (never 0 for non-empty). Pin this so a future `floor` regression is caught.
- **Suggested test:** `test_estimate_tokens_nonempty_min_one` — estimateTokens(" ") === 1 and estimateTokens("ab") === 1.

## DOCUMENT
### EC-2: estimateTokens uses UTF-16 .length (code units), not grapheme/byte count
- **Accepted risk:** a 4-char emoji string may estimate differently than a tokenizer; documented as an approximation. No action.

## Summary
| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T1.1 | 2 | 0 | EC-1 | EC-2 |

**Verdict:** PLAN OK (1 SHOULD TEST — non-empty min-one — fold into T1.1; no MUST FIX)
