# Code-Quality Audit: v33-compaction-token-budget

**Date:** 2026-06-24
**Mode:** plan-bound:v33-compaction-token-budget
**Verdict:** PASS_WITH_CAVEATS
**Score cap:** 89
**Hard caps triggered:** [] (none)
**Soft caps triggered:** [`config_languages_empty` — automated detectors config-disabled; complemented by manual reachability + the knip run baked into `pnpm validate`]

## Honest framing

`.claude/rules/code-quality-languages.txt` enables **zero** languages, so the skill's automated detectors (D1-D4) do not run — a vacuous PASS would be dishonest (known gap, memory `project_theokit_sdk_code_quality_vacuous_pass`). This audit instead reports the **manual reachability analysis** of the V3-3 delta, cross-checked against the **knip dead-code detector that runs inside `pnpm validate`** (which exited 0 on this slice — see `/tmp/v33-validate3.log`, `quality` task green).

## Findings by detector (manual + validate-baked)

### D1 — Dead code
- **knip** (run by `pnpm validate quality` step): exit 0 — no unused export / dead symbol workspace-wide on this slice.
- New public exports (`SUMMARY_TEMPLATE`, `keepTokens`/`marker`/`summaryTemplate`/`failSafe`/`include` option fields, `FilterCheckpointOptions`) are reachable from the `@theokit/sdk/compaction` subpath and exercised by `compaction.test.ts` + `compaction-parity.test.ts` + `compaction-wiring.test.ts` (5 import sites). `SUMMARY_TEMPLATE` is intended public API (theocode adoption). No dead code.
- Private helpers `selectByTokenBudget`, `splitByRecent`, `runSummarize`, `assertMarker`, `FAILSAFE_ABORT` all have a caller within `compaction.ts` (verified by reading the file).
- **Verdict:** clean.

### D2 — Symbol fabrication
Every symbol referenced by the new code resolves to a real definition:
- `redactSecrets` → `internal/security/redact.ts:181` ✓
- `selectCompressionWindow` → `internal/runtime/compression/compression-helpers.ts:27` ✓
- `estimateTokens` → in-module (`compaction.ts`) ✓
- `TheokitAgentError` → `errors.ts` ✓
- `CompressibleMessage` → `internal/runtime/compression/compression-summarizer.ts` ✓
- **Verdict:** no fabrication. (typecheck `tsc --noEmit` exit 0 corroborates — a fabricated import would fail compilation.)

### D3 — Cross-package wiring (orphan exports)
- `SUMMARY_TEMPLATE` + the new option fields are public API on the `@theokit/sdk/compaction` subpath by design (the V3-3 loop-closure consumer is theocode). Documented in `docs.md`. Not an orphan — intended external surface.
- **Verdict:** clean.

### D4 — Mutation testing
- Not run (languages config-disabled; no `## Critical paths` block declared for mutation scope). DEFERRED — the TDD suite (63 tests incl. 7 theocode-parity + EC-1..6 edge tests + fail-safe spy) provides behavioral coverage. INFO, not a cap.

## Cross-validation with `pnpm validate`

| Gate | Result |
|---|---|
| biome (cc ≤ 10, format) | clean |
| typecheck (`tsc --noEmit`) | exit 0 |
| full test suite | 2913 passed / 35 skipped (incl. 63 compaction) |
| knip (dead code) | exit 0 |
| jscpd (duplication) | 0 clones |
| publint + attw | pass |
| bundle budget | PASS (5 entries) |

## Verdict rationale

PASS_WITH_CAVEATS (cap 89): no HARD finding (no dead code, no symbol fabrication). The single caveat is the **config gap** (`code-quality-languages.txt` empty) — the automated detector pass is substituted by the manual reachability audit above + the knip/typecheck/jscpd signals already enforced by `pnpm validate`. This does NOT block `/review` (PASS_WITH_CAVEATS ∈ {PASS, PASS_WITH_CAVEATS} per cycle-review pre-condition).

**Follow-up (not a V3-3 blocker):** enable `typescript` in `code-quality-languages.txt` so future SDK slices get the automated D1-D4 pass (candidate for V3-0 hygiene).
