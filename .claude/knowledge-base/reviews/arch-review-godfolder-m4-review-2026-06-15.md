# Review — M4 internal/runtime god-folder split (+ remediation series)

**Date:** 2026-06-15 · **Branch:** develop · **Cycle:** cycle-review
**Commits reviewed:** `8ec7d96` (cycles), `8a2ce4d` (sdk-memory M5), `44d550c` (sdk runtime M4)

## Verdict: READY_TO_MERGE

Two independent fresh-eyes reviewers (architecture/behavior + test/regression) each
re-verified all claims with git/tsc/madge/vitest and returned READY_TO_MERGE with
**zero BLOCKER/HIGH/MEDIUM/LOW findings**.

## Hard gates (cycle-review)
- Branch = develop (not main). PASS
- No Co-Authored-By trailer in any commit. PASS
- No secret files committed. PASS
- CHANGELOG updated (root + sdk + di + sdk-memory). PASS
- Working tree: no uncommitted production source of this work. PASS

## Dimension results (M4)
| Dimension | Verdict | Evidence |
|---|---|---|
| Behavior preservation | PASS | 44 pure renames (R075-R100), 0 add/0 del; non-import diff lines = import strings + Biome reflow only |
| Import correctness | PASS | `tsc --noEmit` exit 0 |
| Public API | PASS | internal/runtime not an exported subpath; no tsup entry; index.ts export surface unchanged |
| Cycles | PASS | madge = exactly 1 (pre-existing intentional type-only memory/memory-provider) |
| Diff cohesion | PASS | renames + importers + tests + barrel + CHANGELOG + 2 lint-allowlist path updates only |
| Taxonomy | PASS | local-agent/(15) cloud/(6) compression/(6) hooks/(4) budget/(3) memory/(4) session/(3) skills/(3); 18 cross-cutting singletons at root (was 62) |

## Test suites (re-run by reviewer, package configs)
- @theokit/sdk: 2629 passed / 0 failed / 35 skipped (pre-existing env-gated)
- @theokit/sdk-memory: 324 passed / 0 failed
- @theokit/di: 69 passed / 0 failed
- lint allowlists: 6/6 passed, all paths resolve

## Note
Subfolder taxonomy is a proposal — coherent as-is; cheap to reshuffle given the proven pure-move discipline.
