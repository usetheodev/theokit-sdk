# Edge Case Review — m2-context-overflow-boundary (PLAN cycle)

Date: 2026-06-21
Plan analyzed: knowledge-base/plans/m2-context-overflow-boundary-plan.md
Tasks: 2 (T1.1 fix, T2.1 record). Edge cases: 2 (MUST FIX 0, SHOULD TEST 1, DOCUMENT 1)

## MUST FIX
(none — prefer-metadata + fallback + set-once are ADR D1/D2 + T1.1 TDD; the contract test feeds the real mapper.)

## SHOULD TEST
### EC-1: openai-compatible mapper (not just anthropic) also surfaces canonical code
- **Affected task:** T1.1
- **Scenario:** the fix is provider-agnostic (reads metadata.code), but the contract test only uses mapAnthropicError. openai-compatible.ts:57 has the SAME prefixed-code/canonical-metadata shape. A second contract case via mapOpenAiCompatibleError (400 context body) proves the fix covers all mappers.
- **Suggested test:** `test_400_context_overflow_openai_compatible_surfaces_canonical` — registerLoopError(ctx, mapOpenAiCompatibleError(400 context body)) → ctx.error.code === "context_too_long".

## DOCUMENT
### EC-2: the prefixed top-level code remains on the thrown TheokitAgentError
- **Accepted risk:** the fix changes only the loop-boundary code (RunResult.error.code → canonical); the thrown TheokitAgentError keeps the prefixed .code + metadata for telemetry. Documented (D1).

## Summary
| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T1.1 | 2 | 0 | EC-1 | EC-2 |

**Verdict:** PLAN OK (1 SHOULD TEST — openai-compatible contract case — fold into T1.1; no MUST FIX)
