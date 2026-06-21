# Edge Case Review — m2-model-capabilities (PLAN cycle)

Date: 2026-06-21
Plan analyzed: knowledge-base/plans/m2-model-capabilities-plan.md
Tasks: 2 (T1.1 bug fix, T2.1 promotion). Edge cases: 2 (MUST FIX 0, SHOULD TEST 1, DOCUMENT 1)

## MUST FIX
(none — suffix strip + unchanged paths are ADR D1 + T1.1 TDD; promotion wiring is D3 + Final-Phase dts assertion.)

## SHOULD TEST
### EC-1: suffix strip must run for BOTH routing-prefixed and bare ids, and combine with vendor inference
- **Affected task:** T1.1
- **Scenario:** `vertex/claude-3-5-sonnet:beta` → strip routing → `claude-3-5-sonnet:beta` → strip suffix → `claude-3-5-sonnet` → EXACT miss → inferVendorPrefix → `anthropic/claude-3-5-sonnet` → hit. The suffix strip must happen BEFORE inferVendorPrefix so the vendor-inference path also benefits.
- **Suggested test:** `test_suffix_strip_combines_with_vendor_inference` — `resolveModelCapabilities("vertex/claude-3-5-sonnet:nitro")` resolves to the real claude caps (maxContextTokens > 4096).

## DOCUMENT
### EC-2: a model slug legitimately containing ":" would be truncated
- **Accepted risk:** model slugs do not contain ":" except the OpenRouter variant separator; the EXACT keys are colon-free. Documented (D1 drawback).

## Summary
| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T1.1 | 2 | 0 | EC-1 | EC-2 |

**Verdict:** PLAN OK (1 SHOULD TEST — suffix-strip + vendor-inference combine — fold into T1.1; no MUST FIX)
