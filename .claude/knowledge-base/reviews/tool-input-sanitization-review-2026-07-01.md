# Review — tool-input-sanitization

Date: 2026-07-01 · slug `tool-input-sanitization` · branch `develop`
Specialist agents: 5 (architecture, tests, correctness/safety, wiring, cross-validation) + 1 correctness re-review.

## Verdict: **READY_TO_MERGE**

No BLOCKER. The one HIGH finding (correctness Finding 1) was fixed and independently re-reviewed CLEAN. All remaining items were LOW/INFO or addressed. Full SDK suite **3020 passed / 36 skipped**, exit 0.

## Findings & resolution

| # | Dim | Sev | Finding | Resolution |
|---|---|---|---|---|
| F1 | correctness | **HIGH** | `{coerce:true, repairJson:true}` on a `z.string()` field with a JSON-looking value: standalone repair clobbered the schema-accepted raw string into an object → ZodError on a VALID arg | **FIXED** `86facc8` — standalone repair runs only when coerce is off (coerce already embeds the repair candidate). Re-review verdict: **FINDING_1_RESOLVED_CLEAN** (repair still works for object fields + heuristic path; no new bug). Regression test `test_coerce_and_repairJson_keep_schema_confirmed_string_field`. |
| F2 | correctness | MEDIUM | ZodEffects (`.refine()`/`.transform()`) schemas lose `.shape` → heuristic coerces string fields | **FALSE POSITIVE** (Zod v3 behavior). Verified empirically: **Zod v4 `.refine()` keeps `.shape`** → schema-aware coercion works (`name:"5"` stays string). No code change; `objectShape` doc updated to note v4 behavior. |
| T1 | tests | HIGH-ish | `"1e3"` (planned EC-2 case) had no test though code correct | **ADDED** `test_coerce_scientific_notation_stays_string` + 9 more hardening tests (union fallback value, maxDepth leaf-untouched, deep+coerce, array repair, trim:false, coerce-already-typed, notes content). sanitize suite 35→45. |
| W1 | wiring | MEDIUM | root `CHANGELOG.md [Unreleased]` missing entry (Rule 6) | **ADDED** — the manual workspace changelog now has the `### Added` entry (the changeset covers the per-package one). |
| W2 | wiring | MEDIUM | `defineTool` swallows `SanitizeResult.notes` (observability) | **ACCEPTED (design)** — `notes` is reachable on the standalone primitive (the observability seam); adding an `onSanitize` callback to `defineTool` is new public surface not in the plan (YAGNI). Tracked as a possible future enhancement, not a blocker. |
| X1 | cross-val | MEDIUM | plan DoD grep path `packages/sdk/docs.md` doesn't exist | **FIXED** — plan DoD now `docs.md` (workspace root); implementation was already correct. |
| A1/A2 | arch | LOW | misleading "like zod" dep comment; deep+schema nested coercion underdocumented | **FIXED** — comment clarified (jsonrepair is a direct dep); `SanitizeOptions.schema` doc notes nested-fields-use-heuristic under `deep`. |
| X2 | cross-val | LOW | `coerce.ts` helpers lacked `@internal` | **FIXED** — `@internal` on all 5 helpers. |
| X3 | cross-val | LOW | EC-3 spec `raw.trim().startsWith` vs impl `raw.startsWith` | **FIXED** — `tryJson` now `raw.trimStart()` (robust under `trim:false`). |

Positive confirmations across agents: DIP boundary clean (sanitize is pure domain, no transport import; infra→domain direction correct); subpath fully wired (tsup+tsconfig+exports+mirror-dts, publint/attw green); wiring triad satisfied (real callers in define-tool + hermes; integration test; notes seam); all 5 SGs + 5 ADRs faithfully delivered; deferred R5/R6/R7 honestly tracked; docs match the code; no scope creep.

## Evidence

- Fix commit `86facc8`; slice commits `6ee4217`→`4bc6306` + `70f23d6`.
- sanitize suite 45 passed; hermes 13; full SDK suite 3020 passed / 36 skipped, exit 0.
- typecheck clean, biome clean, knip exit 0, publint "All good", attw "No problems 🌟".
- Re-review (correctness): FINDING_1_RESOLVED_CLEAN.
