# Discover Edge Case Review — m3-aci-tools

Date: 2026-06-21
Discovery plan analyzed: .claude/knowledge-base/discoveries/plans/m3-aci-tools-plan.md
Research questions analyzed: 5
Edge cases found: 3 (MUST FIX: 0, SHOULD TEST: 1, DOCUMENT: 2)

## MUST FIX
(none — all cited paths verified; 4 corners mapped; immutability + single-source are explicit Q4/Q5 gates.)

## SHOULD TEST

### EC-1: renderToolList must escape/contain a description with `<`/`>`/`&` so the `<tools>` block stays parseable
- **Affected question:** Q5
- **Suggested halt-loop checkpoint:** before promising Q5 complete, assert the blueprint states how a description containing angle brackets / ampersands is rendered (either XML-escaped or wrapped so the block is not malformed). A naive interpolation of a `<` in a description breaks the pseudo-XML.

## DOCUMENT

### EC-2: withDescription does not validate the new description (empty string allowed)
- **Accepted risk:** the override accepts any string (including empty); the consumer owns the wording. Documented; CustomTool already requires description non-empty at creation, the override trusts the caller. No action.

### EC-3: renderToolList is a prompt aid, not a wire format
- **Accepted risk:** the `<tools>` block is for the system prompt (human/LLM readable), not the provider tool-call schema (that stays `inputSchema`). Documented to avoid confusion.

## Summary

| Question | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------|----------|-------------|----------|
| Q4 | 1 | 0 | 0 | EC-2 |
| Q5 | 2 | 0 | EC-1 | EC-3 |

**Verdict:** DISCOVERY PLAN OK (1 SHOULD TEST — description escaping — elevated to a blueprint must-state; 2 DOCUMENT; no MUST FIX)
