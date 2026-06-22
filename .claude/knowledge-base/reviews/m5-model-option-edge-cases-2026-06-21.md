# Edge Case Review — m5-model-option

Date: 2026-06-21
Plan analyzed: knowledge-base/plans/m5-model-option-plan.md
Tasks analyzed: 4 (T1.1 helpers, T1.2 @public flip, T2.1 re-export, T2.2 wiring)
Edge cases found: 3 (MUST FIX: 0, SHOULD TEST: 2, DOCUMENT: 1)

## Boundary map

Pure string transforms over the already-hardened `parseModelId` (which handles empty/undefined, no-prefix, trailing-slash). The only live edges are humanization corner cases: multiple `:` in a slug, and a token that is purely numeric/already-cased.

## MUST FIX

(none — pure deterministic transform; `parseModelId` owns the parse edges.)

## SHOULD TEST

### EC-1: a slug with multiple `:` (split at the FIRST colon only)
- **Affected task:** T1.1
- **Family:** Format
- **Scenario:** `"openrouter/x/y:free:beta"` — splitting `name` at the FIRST `:` yields `base="x/y"`, `variant="free:beta"`. The variant should keep the remainder (not drop it), rendered as `… (free:beta)`.
- **Suggested test:** `humanizeModelName_multiple_colons` — assert the full variant tail is preserved in parens.

### EC-2: a token that is already an acronym or all-caps stays sane
- **Affected task:** T1.1
- **Family:** Format
- **Scenario:** `gpt` → `GPT` (acronym set); a numeric token like `4o`/`3` stays as-is (capitalize of a digit-leading token is a no-op); an unknown token title-cases.
- **Suggested test:** `humanizeModelName_acronym_and_numeric` — `gpt`→`GPT`, `4o`→`4o`, `sonnet`→`Sonnet`.

## DOCUMENT

### EC-3: humanization is best-effort, not vendor-canonical
- **Accepted risk:** `humanizeModelName("anthropic/claude-3-5-sonnet")` → `"Claude 3 5 Sonnet"` (version dashes become spaces) — not Anthropic's marketing "Claude 3.5 Sonnet". This is the deterministic, dependency-free contract (ADR D2); a UI wanting exact marketing names overrides per-id. Documented on the function. No action.

## Summary

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T1.1 | 3 | 0 | EC-1, EC-2 | EC-3 |
| T1.2 | 0 | 0 | 0 | 0 |
| T2.1 | 0 | 0 | 0 | 0 |
| T2.2 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN OK (2 SHOULD TEST — multiple-colon variant + acronym/numeric tokens — fold into T1.1 TDD; EC-3 docstring note; no MUST FIX)
