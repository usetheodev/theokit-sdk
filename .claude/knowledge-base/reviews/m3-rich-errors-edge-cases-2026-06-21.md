# Discover Edge Case Review — m3-rich-errors

Date: 2026-06-21
Discovery plan analyzed: .claude/knowledge-base/discoveries/plans/m3-rich-errors-plan.md
Research questions analyzed: 5
Edge cases found: 3 (MUST FIX: 0, SHOULD TEST: 1, DOCUMENT: 2)

## MUST FIX
(none — all cited paths verified; 4 corners mapped; never-throw passthrough is the explicit Q5 gate.)

## SHOULD TEST

### EC-1: handler output that is not JSON (or not an object) must pass through unchanged
- **Affected question:** Q5
- **Suggested halt-loop checkpoint:** before promising Q5 complete, assert the blueprint specifies that if `JSON.parse(handlerOutput)` throws OR the parsed value is not an object with `ok===false`, the wrapper returns the ORIGINAL string verbatim (never throws, never corrupts). Some custom tools legitimately return non-JSON strings.

## DOCUMENT

### EC-2: existing `guidance` field must be preserved (idempotency)
- **Accepted risk:** if a tool already attached its own `guidance`, the wrapper must NOT overwrite it. Documented as an additive-only rule (only inject when absent). No action beyond stating it.

### EC-3: guidance is best-effort, not a contract the LLM must obey
- **Accepted risk:** the hint is advisory text for self-correction, not a machine-readable directive; an unknown error code simply gets no guidance (graceful). Documented.

## Summary

| Question | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------|----------|-------------|----------|
| Q4 | 1 | 0 | 0 | EC-2 |
| Q5 | 2 | 0 | EC-1 | EC-3 |

**Verdict:** DISCOVERY PLAN OK (1 SHOULD TEST — non-JSON passthrough — elevated to a blueprint must-state; 2 DOCUMENT; no MUST FIX)
