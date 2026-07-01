# Edge Case Review — tool-input-sanitization

Date: 2026-07-01
Tasks analyzed: 5 (T1.1, T1.2, T2.1, T3.1, T4.1)
Cases found: 7 (EDGE: 2, NEGATIVE: 5 | MUST FIX: 4, SHOULD TEST: 3, DOCUMENT: 0)

The primitive's contract is "total, never throws, only changes hygiene not meaning" — the strongest risks are NEGATIVE cases where a naive coerce/repair silently CHANGES MEANING (data corruption), which is worse than a throw.

## MUST FIX

### EC-1: non-object input must not throw (total contract)
- **Affected task:** T1.1
- **Kind:** NEGATIVE
- **Family:** Input
- **Scenario:** a model emits a bare string / array / `null` as the tool args; `sanitizeToolInput(null)` or `sanitizeToolInput(["x"])` is called (the runtime type is `unknown`, the `Record` is a compile-time hint only).
- **Impact:** `Object.entries(null)` throws → violates the "never throws / total" invariant the whole design rests on.
- **Suggested fix:** guard at entry — `if (input === null || typeof input !== "object" || Array.isArray(input)) return { value: input, changed: false, notes: [] }`.

### EC-2: numeric coercion must round-trip AND be finite (no ID / precision corruption)
- **Affected task:** T1.1
- **Kind:** NEGATIVE
- **Family:** Format
- **Scenario:** coerce:true on `{ id: "12345678901234567890" }` → `Number()` → lossy float; on `{ code: "007" }` → `7` (leading zeros lost); on `{ x: "NaN" }` → `NaN`; on `{ y: "1e3" }` → `1000`.
- **Impact:** silent data corruption of ID-like string args — the single most dangerous coercion bug (a wrong-but-plausible value flows to the handler).
- **Suggested fix:** coerce to number ONLY when `Number.isFinite(n) && String(n) === raw.trim()` (round-trip guard) — this rejects big-ints, leading-zeros, `NaN`/`Infinity`, and `"1e3"`≠`"1000"`, leaving them as strings.

### EC-3: `repairJson` must fire only on JSON-looking values
- **Affected task:** T1.1
- **Kind:** NEGATIVE
- **Family:** Format
- **Scenario:** repairJson:true on `{ note: "hello world" }` — `jsonrepair("hello world")` may wrap/mangle a plain string into `"hello world"` or throw.
- **Impact:** a plain-text arg is corrupted into (in)valid JSON — meaning changed.
- **Suggested fix:** gate the repair branch on `const t = raw.trim(); if (t.startsWith("{") || t.startsWith("["))` — only attempt repair+parse on object/array-looking strings; else leave untouched.

### EC-4: schema-aware coercion only for `z.object` shape; else fall back safely
- **Affected task:** T1.1
- **Kind:** NEGATIVE
- **Family:** Boundary
- **Scenario:** `schema` is a `z.union` / `z.record` / `z.effects` (refinement/transform) with no per-key `.shape`; the code tries `schema.shape[key]` → `undefined`/throws.
- **Impact:** crash or wrong per-key type decisions for non-object schemas.
- **Suggested fix:** use schema-aware coercion only when `schema` is a ZodObject exposing `.shape` (guard `"shape" in schema`); otherwise fall back to heuristic coercion (or no-op) — never throw.

## SHOULD TEST

### EC-5: whitespace-only value trims to empty string
- **Affected task:** T1.1
- **Kind:** EDGE
- **Suggested test:** `test_whitespace_only_string_trims_to_empty` — `{ x: "   " }` → `{ x: "" }`, `changed=true`, one note. Assert the correct boundary result (intentional: empty-but-valid, downstream schema decides validity).

### EC-6: `deep` recursion is bounded (no stack overflow on cycles / deep nesting)
- **Affected task:** T1.1
- **Kind:** NEGATIVE
- **Suggested test:** `test_deep_recursion_bounded_by_maxDepth` — a nested object deeper than `maxDepth` (default e.g. 8) stops recursing at the cap (no throw, no hang); assert values beyond the cap are left untouched.

### EC-7: internal delegation still trims the KEY (not just the value)
- **Affected task:** T3.1
- **Kind:** EDGE
- **Suggested test:** `test_parseHermesParams_still_trims_key` — `<parameter= path >` (spaces around key) still yields key `path`; delegation of VALUE trim to the sanitizer must not drop the existing KEY trim (keys are record keys, trimmed at build time).

## Summary

| Task | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|------|------|----------|----------|-------------|----------|
| T1.1 | 1 | 5 | 4 | 2 | 0 |
| T1.2 | 0 | 0 | 0 | 0 | 0 |
| T2.1 | 0 | 0 | 0 | 0 | 0 |
| T3.1 | 1 | 0 | 0 | 1 | 0 |
| T4.1 | 0 | 0 | 0 | 0 | 0 |

**Coverage check:** T1.1 (the sole real input boundary) has both EDGE and NEGATIVE lenses covered; T2.1/T3.1 inherit the primitive's guards; T1.2/T4.1 are wiring/validation (no new input boundary).

**Verdict:** PLAN NEEDS ADJUSTMENT (4 MUST FIX absorbed into v1.1)
