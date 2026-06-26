# Review — v33-compaction-token-budget (V3-3)

**Date:** 2026-06-24 · **Slug:** v33-compaction-token-budget
**Commits reviewed:** `f2203ed` (feat) + `dddbc7f` (cq audit) on `develop` (theokit-sdk); doc-accuracy fix follow-up commit.
**Reviewers:** 3 independent fresh-eyes agents (driver-correctness · public-API/architecture/DRY/docs · test-quality/cross-validation).
**Verdict:** **READY_TO_MERGE** (3 PASS lenses, 0 BLOCKER, 0 HIGH, 0 MEDIUM; 1 LOW addressed, remainder INFO/advisory).

## Overview
V3-3 (gap V2-2B-2): adds a **token-budget mode** + **configurable marker** + **template-driven summarizer** + **opt-in fail-safe** to `@theokit/sdk/compaction`, reaching behavioral parity with theocode so it can adopt the SDK helper and delete `server/lib/compaction.ts` (anti-reinvention baseline 2→1). Strictly additive: every new option defaults to M2 behavior; the persisted `[[theokit:checkpoint]]` marker and the documented propagate-on-throw contract are unchanged. One production file (`compaction.ts`, 128→288 LoC) + tests + docs + changeset. Zero new dependency.

## Lens verdicts

### Driver correctness — PASS
Hand-traced all 4 deltas + 7 runtime edge cases; no correctness bug. `selectByTokenBudget` is a character-exact port of theocode `splitTranscript` (same `acc`/`splitIndex`, `i<len-1` guard, strict `>` boundary, always ≥1 recent, `head+recent==all`). `keepTokens` 0/negative → exactly 1 recent (no throw); single over-budget turn → head empty → returns `[...messages]`. Marker threaded correctly through all 4 functions; custom-marker checkpoint in the older window NOT misclassified as a system prompt. Template 2nd-arg backward-compatible; 1-arg callbacks still run. Fail-safe opt-in, default propagates in BOTH modes, returns ORIGINAL via the private `FAILSAFE_ABORT` symbol, warn routed through `redactSecrets`, non-Error throw handled. `include` after(default)/from correct. 24 pre-existing M2 tests semantically green (defaults unchanged).

### Public-API / architecture / DRY / docs — PASS
ISP-clean (5 optional additive fields, defaults reproduce M2). `summarize` 2nd-param widening confirmed backward-compatible in TS structural typing (fewer-param function assignable). Exporting `SUMMARY_TEMPLATE` is the right "expose the default constant" pattern (theocode is a concrete second consumer). docs.md fully synced + accurate, including the D6 per-mode system-prompt difference stated explicitly and the opt-in fail-safe preserving the documented propagate default. DRY: `pnpm run quality:duplication` → 0 clones; the two split functions encode genuinely different knowledge (token budget vs turn count + system handling) — justified, not a violation. `redactSecrets` warn sink is the correct ADR D68/D73 convention (mirrors `internal/workflow/step-branch.ts` precedent); no layering inversion. ADRs D1-D7 each carry a rejected alternative + sound rationale; backward-compat airtight across all three break vectors (existing callers, persisted marker, propagate default).

### Test quality / cross-validation — PASS
`compaction.ts` at 100% stmt/func/line, 97.72% branch (the one uncovered branch is the unreachable `?? ""` defensive fallback). Tests behavior-focused (private `selectByTokenBudget` verified through public output, not imported), AAA, one-assertion, deterministic (no time/random/I/O). console.warn spy robust (Error + non-Error paths, mockRestore). Every Coverage-Matrix gap (1-10) maps to a real passing test; all 5 SHOULD-TEST edge cases (EC-1..EC-5) implemented; EC-6/EC-7 correctly DOCUMENT-only. Plan↔impl test-name renames justified (private fn tested via public API).

## LOW finding — addressed
- (Test lens) The "9-test corpus / mirrors theocode's corpus" wording overstated parity: theocode has **8** `it()` blocks; the suite mirrors **7**. The 8th (`isOverflowError`, message-regex) is INTENTIONALLY divergent — the SDK uses the typed `context_too_long` code (`isContextOverflowError`), a superior design covered separately. **Fixed**: corrected the count + divergence note in the plan (T4.1 objective + Evidence), the parity-suite header, and this report. No code change — the divergence is by design.

## INFO / advisory (no action required this slice)
- theocode's `noop_when_under_budget` asserts array-element ref identity (`toBe(messages[0])`); the SDK returns `[...messages]` (new array, **same element refs** — element-level identity preserved; only array identity differs). theocode does not require array identity. Flagged for the theocode-adoption follow-up.
- A second docs example exercising the `(older, template)` 2-arg summarize would round out the docs (the 1-arg example demonstrates backward-compat; prose covers the 2-arg form).
- Pre-existing (out-of-scope): `internal/eval/runner.ts` has unredacted `console.warn(err.message)` — a potential D73 follow-up, predates V3-3.

## Validation (all green)
`pnpm validate` exit 0: full suite **2913 passed / 35 skipped** (incl. 63 compaction: 24 M2 + 22 V3-3 + 7 parity + 2 sink-gate + extended wiring); typecheck exit 0; biome cc ≤ 10 clean; `compaction.ts` 288 LoC ≤ 500; jscpd **0 clones**; knip 0 dead; publint + attw pass; bundle budget PASS. Plan-confidence SHIPPABLE 90.8; deps-audit PASS (zero new deps); code-quality PASS_WITH_CAVEATS.

## Conclusion
A clean, additive, parity-driven slice with complete ADRs, honest Drawbacks, 0 clones, and 100% line coverage on the changed file. Three independent fresh-eyes lenses found no BLOCKER/HIGH/MEDIUM. The single LOW (a parity-count wording overstatement) is corrected; everything else is advisory or an out-of-scope pre-existing observation. Backward compatibility is airtight (every M2 caller, the persisted marker, and the propagate-on-throw default are preserved). **Verdict: READY_TO_MERGE.**

## Loop-closure follow-up (out of this slice)
Per ROADMAP-v3 V3-3: theocode MAY now adopt `compactTranscript` from `@theokit/sdk/compaction` (token-budget + `marker:'<conversation-checkpoint>'` + `failSafe:true` + `include:'from'` + a thin string→message summarize adapter), delete `server/lib/compaction.ts`, and remove `compaction` from its anti-reinvention baseline (2→1). That adoption happens in the theocode repo.
