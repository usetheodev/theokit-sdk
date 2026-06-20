# Review: M1-3 — `buildReplayHistory`

**Date:** 2026-06-20
**Slug:** `m1-continuation-history`
**Commits reviewed:** 54a9f72, d7d5215 (fixes in 0ffa3ac)
**Reviewers:** 5 specialist agents (correctness, test-quality, architecture, cross-validation/wiring, API/DX)

## Verdict

**READY_TO_MERGE** — after the review-fix round. No BLOCKER at any stage; all HIGH + correctness findings resolved.

## Per-agent verdicts (initial)

| Agent | Verdict | HIGH |
|---|---|---|
| correctness (trim/pair logic) | READY | 0 (2 MEDIUM: positional pairing orphans on interleaved/non-adjacent calls) |
| test-quality | NEEDS_FIXES | 2 (vacuous pair-safety test; untested error branch) |
| architecture (DIP/reuse/DTS) | READY | 0 (DTS-bundle-cycle risk verified SAFE against the real build artifact) |
| cross-validation/wiring | READY | 0 (2 INFO: changelog location; perItemCap default wording) |
| API/DX | READY | 0 (3 MEDIUM: budget-0 wording, StoredMessage JSDoc, mapping-note prominence) |

## Findings resolved (commit 0ffa3ac)

- **MEDIUM×2 + HIGH (the load-bearing fix):** tool-pair safety was positional → orphaned `tool_result` on interleaved/non-adjacent tool calls, AND the test proving it was vacuous (budget 0 zeroed content, trim loop never ran). Re-paired by `call_id` (`evictionIndices` drops a turn + all turns sharing its `call_id`); replaced the vacuous test with a real-drop non-adjacent test + an interleaved-multiple-pairs test.
- **HIGH:** `error` tool status untested → added `test_tool_error_status_maps_to_tool_result`.
- **MEDIUM:** lone tool_call + mixed text+tool_use untested → added both tests.
- **MEDIUM (DX):** budget-0 docs wording imprecise → reworded honestly.
- **MEDIUM (DX):** `StoredMessage.role` JSDoc stale ("forward compat reserved") + mapping requirement buried → JSDoc reconciled + promoted an **Important** note in docs.md.
- **INFO:** changelog in root (workspace manual changelog) vs package (changeset-generated) — clarified.

Tests: 17 → 21 GREEN.

## Verified strengths (from the reviews)

- Architecture: pure (no I/O), genuine `truncateWithMarker` reuse (Rule 9), barrel export does NOT reintroduce the rollup-plugin-dts cycle (confirmed against `dist/index.d.ts`).
- Cross-validation: faithful to blueprint ADRs D1-D5; all EC-1..EC-6 implemented + tested; wiring triad genuine (public export + barrel-crossing integration test); commits conventional, on develop, no Co-Authored-By.
- Correctness: budget math always finite ≥ 0; trim loop terminates with no `total` drift; purity holds.

## Gates

tsc clean · Biome clean (cognitive-complexity ≤ 10) · knip clean (no orphan) · full SDK suite 2706 passed / 0 failed.
