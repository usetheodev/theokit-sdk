# Edge Case Review — m3-aci-tools (PLAN cycle)

Date: 2026-06-21
Plan analyzed: knowledge-base/plans/m3-aci-tools-plan.md
Tasks analyzed: 2 (T1.1 helpers, T2.1 export/docs)
Edge cases found: 2 (MUST FIX: 0, SHOULD TEST: 1, DOCUMENT: 1)

## Boundary map
Both functions are pure. Live edge family: string escaping (angle brackets/ampersands in name/description) + empty-array render. No I/O.

## MUST FIX
(none — escaping + empty-safe are ADR D4 + T1.1 TDD; immutability tested.)

## SHOULD TEST

### EC-1: ampersand escaping order (escape & BEFORE < and >)
- **Affected task:** T1.1
- **Family:** Format
- **Scenario:** if `esc` replaces `<`→`&lt;` first and `&`→`&amp;` second, the just-inserted `&lt;` becomes `&amp;lt;` (double-escaped). The `&` replacement MUST run first.
- **Suggested test:** `test_render_escapes_ampersand_first` — a description `"a < b & c"` → contains `&lt;` and `&amp;` exactly once each (no `&amp;lt;`).

## DOCUMENT

### EC-2: renderToolList output is for the system prompt, not the provider tool schema
- **Accepted risk:** the `<tools>` block is a prompt aid; the provider still gets `inputSchema`. Documented. No action.

## Summary

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T1.1 | 2 | 0 | EC-1 | EC-2 |
| T2.1 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN OK (1 SHOULD TEST — ampersand-first escaping — fold into T1.1 TDD; no MUST FIX)
