# Review — m4-project-instructions (M4-2)

**Date:** 2026-06-21
**Verdict:** READY_TO_MERGE
**Commits:** 29b1c8c (impl) + 49580a3 (review-fix)
**Plan:** knowledge-base/plans/m4-project-instructions-plan.md (plan-confidence SHIPPABLE 94.4)
**Code-quality:** PASS

## Method

Two independent FAANG-level reviewers (read-only), in parallel — architecture/cross-validation + tests/wiring/edge-cases. BOTH independently surfaced the same HIGH (writer path-traversal), giving high confidence in the finding.

## Findings adjudicated

| # | Sev | Source | Finding | Resolution |
|---|---|---|---|---|
| 1 | **HIGH** | A + B (both) | Security asymmetry: the reader guards `filename` via `isSafePattern` (through `walkUpForFile`), but `writeProjectInstructions` passed `filename` straight to `join(cwd, filename)` → a `../` or absolute `filename` escaped `cwd`. | **FIXED** (49580a3): `writeProjectInstructions` now rejects unsafe filenames (traversal/absolute) with `ConfigurationError(code: "unsafe_filename")` — symmetric with the reader, fail-loud per ADR D4. Contained subpaths (`sub/THEO.md`) remain allowed (cannot escape cwd). Regression test added (traversal + absolute reject; traversal target not created). |
| 2 | MEDIUM | B | EC-3 (writer fails loud on missing parent dir) documented but not asserted — a refactor to `atomicWriteText` (which mkdir-p's) would silently break it. | **FIXED** (49580a3): added `fails loud when the parent directory does not exist` test. |
| 3 | MEDIUM | B | empty-content write untested; `content:""` (falsy) vs `undefined` (absent) distinction unpinned. | **FIXED** (49580a3): added `writes empty content as a present (not absent) file` test (`content===""`, `files` length 1). |
| 4 | LOW | B | merge ordering only verified at 2 levels (a reverse bug only manifests at N≥3). | **FIXED** (49580a3): added a 3-level merged test asserting `ROOT\n\nMID\n\nLEAF`. |
| 5 | INFO | A,B | merged root-first ordering, never-throw reader, fail-loud writer, full subpath wiring (no DTS duplicate-emit / cross-subpath breakage), ESM/CJS resolution — all verified correct. | No action. |

## Verdict rationale

Both reviewers returned NEEDS_FIXES solely on finding #1 (the writer traversal HIGH), each explicitly stating the rest (architecture/DIP, ordering correctness, never-throw/fail-loud, full wiring, DTS emit, typecheck, 12/12 tests) was solid and that fixing #1 flips it to READY_TO_MERGE. #1 is fixed (symmetric `isSafePattern` guard, the SDK's own canonical traversal guard) and all four findings now have regression tests. The fix is verified: `../escaped.md` and `/tmp/abs-escape.md` both throw `unsafe_filename`; contained subpaths still work.

## Validation (post-fix)

- typecheck: clean (0 errors)
- project + skills tests: 16 passed (project-instructions 14 + wiring 2)
- full sdk suite: see Final Phase below (no regression)
- biome clean; ADRs D1–D5 delivered; Coverage Matrix 8/8.

**Verdict:** READY_TO_MERGE
