# Review — sdk-compaction-toollist-promotions (RADAR #90-A)

**Date:** 2026-06-26 · **Slug:** sdk-compaction-toollist-promotions · **Commit:** `5bd2f9c`
**Reviewer:** independent verification (backward-compat + purity focus). **Verdict: READY_TO_MERGE**

## Gates
- Targeted: `@theokit/sdk` compaction **64 passed**; `@theokit/sdk-tools` tool-aci **19 passed** (independently re-run).
- Full `pnpm test` (turbo): **23/23 successful**; `@theokit/sdk` package **2919 tests passed** (35 env-gated skips, pre-existing).
- `pnpm typecheck`: **22 tasks, 0 errors** (proves the optional-param additions don't shift inference).
- Biome: **clean** on the 4 changed files (pre-commit gate passed).
- plan-confidence: **SHIPPABLE 92.0** (0 hard caps, coverage 100%, acceptable_ratio 1.0).
- RED→GREEN confirmed: 1 new compaction failure + 7 new tool-aci failures observed RED before the source change.

## What shipped (additive, backward-compatible)
- `@theokit/sdk` `ShouldCompactInput.maxOutput?: number`; `shouldCompact` → `estimated >= contextWindow - buffer - (maxOutput ?? 0)`. Omitted ⇒ legacy result.
- `@theokit/sdk-tools` `renderToolList(tools, options?: { mode?: 'full'|'summary'|'names' })`. `'full'` (default) = existing `<tools>` XML byte-for-byte; `'summary'` = markdown `- name: <first sentence>` (abbreviation-safe via `/\.\s+(?=[A-Z(]|$)/`); `'names'` = `- name`.
- Changeset: `@theokit/sdk` minor + `@theokit/sdk-tools` minor.

## Adversarial verification (dominant risk = backward-compat — refuted)
- **`maxOutput` default `?? 0`:** verified the formula reduces to `estimated >= contextWindow - buffer` when omitted; the "omitted == legacy" + "maxOutput:0 == omitted" tests assert it; all pre-existing compaction tests green. Pure arithmetic — no shared state.
- **`renderToolList` 2nd param:** the `'full'` branch is the existing body verbatim (all pre-existing escaping/empty/override tests green). The `.map(renderToolList)` hazard (a numeric index as 2nd arg) is covered: a non-object has no `.mode` → `'full'` fallback (tested, no crash).
- **Markdown modes don't XML-escape:** asserted (a `<b>` stays literal in summary mode) — correct, markdown is not XML.
- **`firstSentence` abbreviation-safe:** reuses the consumer-proven regex; tested that "e.g." is not a cut point.
- **Purity:** both functions remain pure (no I/O, no async, no shared state). `real-llm-validation.md` N/A (no LLM path). `no-stubs-no-mocks-no-wired.md` satisfied (both symbols have real callers via barrels + tests; no stubs/mocks added to src).
- Diffs spot-checked real (not vacuous): `maxOutput ?? 0` present in the formula; `ToolListMode` + `firstSentence` + `mode ?? "full"` present.

## Findings
- **INFO (signature 2nd param):** documented the `.map(renderToolList)` fallback in the function JSDoc + a regression test; near-zero real-world risk (object-only option read). Accepted.
- No BLOCKER/HIGH/MEDIUM.

## Decision
Two additive pure-function promotions with default-preserving optionals, full test coverage incl. backward-compat + edge cases, RED→GREEN confirmed, all gates green. **READY_TO_MERGE.** Next: theokit-sdk `develop → main` PR; on merge, changeset version-bump + manual publish (`@theokit/sdk` minor, `@theokit/sdk-tools` minor). TheoCode adoption (#90-C) consumes the published versions; #90.3 (typing) ships separately in theokit (@theokit/agents).
