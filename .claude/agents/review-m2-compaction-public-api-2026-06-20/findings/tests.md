# Test Review — m2-compaction-public-api (M2-1)

Review target: `packages/sdk/tests/compaction.test.ts` (19 unit) + `packages/sdk/tests/compaction-wiring.test.ts` (2 integration), production `packages/sdk/src/compaction.ts`.
Plan: `.claude/knowledge-base/plans/m2-compaction-public-api-plan.md` (T1.1/T1.2/T2.1 TDD + EC-1/EC-2/EC-3).
Suite status: 21/21 GREEN (`vitest run`, 44ms). Pyramid: 19 unit + 2 integration + 0 E2E — correctly shaped, not inverted.

## Coverage verdict (plain)

Every scenario the plan declares is exercised by a non-vacuous assertion, and every async call is correctly `await`ed:

| Plan scenario | Test | OK |
|---|---|---|
| keep-recent | `test_compactTranscript_keeps_last_keepRecent` (l.95) | yes |
| system-preservation | `test_compactTranscript_preserves_system` (l.100) | yes |
| summarize-prepend | `test_compactTranscript_summarize_prepends_summary` (l.105) | yes |
| no-summarize-drop | `test_compactTranscript_no_summarize_drops_older` (l.113) | yes |
| empty / only-system (EC-1) | `..._empty_returns_empty` (l.136) + `..._only_system_unchanged` (l.140) | yes |
| marker-last (EC-2) | `test_filterFromLatestCheckpoint_marker_last_returns_empty` (l.86) | yes |
| subclass-overflow (EC-3) | `test_isContextOverflowError_true_on_subclass` (l.51) | yes |
| no-mutation | `..._does_not_mutate_input` (l.124) + `filterFromLatestCheckpoint_does_not_mutate` (l.79) | yes |
| default keepRecent=6 | `test_compactTranscript_default_keepRecent_6` (l.131) | yes |
| shorter-than-keepRecent | `test_compactTranscript_shorter_than_keepRecent_noop` (l.118) | yes |

AAA structure is clean throughout (Arrange via `msg`/`convo` helpers, Act = the call, Assert = `expect`). No `.only`, no `.skip`, no commented-out tests, no time/random nondeterminism, no over-mocking. The `summarize` callbacks are precise fakes (the only seam), per testing.md §2/§3.

## [MEDIUM] No test for checkpoint + compactTranscript interaction (checkpoint markers survive as system turns)
- file: packages/sdk/tests/compaction.test.ts (gap; impl at packages/sdk/src/compaction.ts:44)
- detail: `buildCheckpoint()` returns a `role:"system"` turn (compaction.ts:59). `compactTranscript` preserves system turns via `messages.filter(m => m.role === "system")` (compaction.ts:44), which ALSO matches checkpoint markers. The plan's own pseudo-code (plan l.232) explicitly intended to EXCLUDE checkpoint markers from the preserved-system set (`m.role === "system" && !content.startsWith(CHECKPOINT_MARKER)`), but the shipped code drops that guard. The two public helpers (`buildCheckpoint`/`filterFromLatestCheckpoint` and `compactTranscript`) are designed to be used on the same transcript, yet NO test exercises a transcript that contains both a checkpoint and triggers compaction. Verified empirically: a checkpoint turn is retained verbatim in `compactTranscript` output as if it were a system prompt. This is a real divergence between plan intent and implementation that the test suite is silent on — a behavior-coverage gap, not a structural one. Whether the divergence is a bug or an intentional simplification is the domain reviewer's call; the test gap is mine to flag.
- fix: Add `test_compactTranscript_excludes_checkpoint_markers_from_preserved_system` (or, if the retained-marker behavior is deliberate, `test_compactTranscript_retains_checkpoint_marker`) asserting the documented behavior. Pin whichever semantics the team confirms so the contract is locked against silent drift.

## [LOW] `test_compactTranscript_only_system_unchanged` passes for two different reasons (assertion under-specifies)
- file: packages/sdk/tests/compaction.test.ts:140
- detail: With `[system,system]` and `keepRecent:1`, `nonSystem` is empty → `selectCompressionWindow` returns `toCompress:[]` → early `return [...messages]`. The test asserts `toEqual(input)`, which is correct, but it would ALSO pass if the early-return branch did not exist and the code instead reassembled `[...system, ...toPreserve]` (same content). The test confirms the OUTPUT but does not pin that the no-op short-circuit (compaction.ts:47-49) is the path taken, which is the EC-1 intent ("locks the selectCompressionWindow short-circuit path", edge-case review l.24). Minor: the behavioral output is still asserted correctly.
- fix: Optional — add an assertion that `summarize` is NOT invoked on the only-system path (pass a spy `summarize` and assert it received 0 calls). That distinguishes the short-circuit from an accidental reassembly and directly locks the EC-1 contract.

## [INFO] system-preservation test asserts position but not non-duplication
- file: packages/sdk/tests/compaction.test.ts:100
- detail: `test_compactTranscript_preserves_system` asserts `out[0]` equals the system message. It does not assert the system message appears EXACTLY once (the `system` array is concatenated with `toPreserve`, which excludes system turns, so duplication cannot occur today — but the test would not catch a regression that re-introduced a system turn into the preserved tail). Low value to add given current code shape; noting for completeness.
- fix: Optional — assert `out.filter(m => m.role === "system").length === 1` to make the single-system invariant explicit.

## [INFO] Integration test name contains an implicit "and" (multi-behavior in one `it`)
- file: packages/sdk/tests/compaction-wiring.test.ts:22
- detail: `test_compaction_symbols_importable_and_work` bundles four assertions (checkpoint round-trip, summarize delegation, system preservation, overflow predicate) into one `it`. Per testing.md §3 ("'and' in the test name is a smell"), a strict unit test would split these. For an INTEGRATION smoke whose purpose is "all symbols importable and wired end-to-end through the public surface" this is acceptable and intentional (it mirrors the wiring-triad pillar-b check). Not worth splitting — flagged only against the literal rule. The companion `test_subpath_declared_in_package_json` (l.53) is appropriately single-purpose.
- fix: None required. If pedantic AAA per-behavior is desired later, split into 4 `it` blocks sharing a `beforeEach` transcript fixture.

## Summary

- BLOCKER: 0
- HIGH: 0
- MEDIUM: 1 (checkpoint × compaction interaction untested — divergence from plan pseudo-code)
- LOW: 1
- INFO: 2

Coverage of the plan's declared scenarios is adequate and the assertions are real (no vacuous tests, awaits correct, AAA clean, no skipped/only). The single substantive gap is the untested interaction between the two public surfaces shipped in the same module (checkpoints + compaction), where the implementation also silently diverges from the plan's pseudo-code on checkpoint-marker handling.
