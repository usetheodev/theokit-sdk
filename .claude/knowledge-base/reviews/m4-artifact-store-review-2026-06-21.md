# Review — m4-artifact-store (M4-4)

**Date:** 2026-06-21
**Verdict:** READY_TO_MERGE
**Commits:** 0fe0f28 (impl) + d37bc53 (review-hardening)
**Plan:** knowledge-base/plans/m4-artifact-store-plan.md (plan-confidence SHIPPABLE 98.0)
**Code-quality:** PASS

## Method

Two independent FAANG-level reviewers (read-only), in parallel — architecture/cross-validation/traversal/overload + tests/wiring/edge-cases. BOTH returned **READY_TO_MERGE** (0 BLOCKER, 0 HIGH). The findings below were addressed anyway to honor the "no workarounds / all validated" bar.

## Findings adjudicated

| # | Sev | Source | Finding | Resolution |
|---|---|---|---|---|
| 1 | MEDIUM | B | Default `idStrategy` (`safeFilenameForId`) case-folds — case-only-different ids (`"Run-1"`/`"run-1"`) collide → `read` returns the wrong artifact silently. (A known property of the shipped `safeFilenameForId`, flagged in the plan's Drawbacks as the non-roundtrippable-id risk.) | **DOCUMENTED + LOCKED** (d37bc53): prominent case-folding warning on `idStrategy` + `write` docstrings ("case-sensitive ids need a custom strategy"); intent-locking test asserts the documented lossy behavior so it can't be mistaken for a bug later. |
| 2 | LOW | A | `has()` read the entire file just to test existence. | **FIXED** (d37bc53): `has()` now uses `stat` (O(1), no full-file load; still never-throws). |
| 3 | LOW | A | traversal test used `startsWith(dir)` (a sibling `dir-evil` would falsely pass). | **FIXED** (d37bc53): tightened to `startsWith(dir + sep)`. |
| 4 | LOW | B | store-variant plan-mode untested for invalid-action; cross-extension list + multiline/empty content untested (behavior confirmed correct). | **HARDENED** (d37bc53): added async invalid-action test, multiline/empty byte-for-byte roundtrip test, cross-extension list-exclusion test. |
| 5 | INFO | A,B | DIP clean; traversal end-to-end safe (`safeFilenameForId` hashes `..`/absolute/`/`; `safePathJoin` throws on a custom-strategy escape — fail-loud); overload preserves the SYNC zero-arg handler; atomic single-path write; `list()` stems + EC-4 overwrite documented; no production caller beyond the barrel (library tool-factory pattern, consistent with siblings). | No action. |

## Verdict rationale

Both reviewers independently confirmed: architecture/DIP clean, all 5 ADRs delivered, Coverage Matrix 9/9, traversal neutralization correct end-to-end (incl. a custom-strategy escape failing loud via `safePathJoin`), the zero-arg `createPlanModeTool()` SYNC handler preserved (existing tests green), and the store-variant async handler persisting only on `exit` with a non-empty plan. The single MEDIUM is a documentation/contract-clarity item on the already-public `safeFilenameForId`'s case-folding — now documented + locked by test. All LOWs fixed.

## Validation (post-hardening)

- typecheck: clean (0 errors)
- artifact-store + plan-mode tests: 22 passed
- full sdk-tools suite: **282 passed / 27 files** (no regression — baseline 260; +22 M4-4 tests)
- biome clean; code-quality PASS.

**Verdict:** READY_TO_MERGE
