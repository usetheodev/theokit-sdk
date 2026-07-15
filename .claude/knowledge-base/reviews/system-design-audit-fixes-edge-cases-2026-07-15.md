# Edge Case Review — System-Design Audit Fixes (SE43)

Date: 2026-07-15
Tasks analyzed: 8 (T1.1, T2.1, T3.1, T3.2, T4.1–T4.4)
Cases found: 5 (EDGE: 1, NEGATIVE: 4 | MUST FIX: 2, SHOULD TEST: 2, DOCUMENT: 1)

This plan is internal restructuring + manifest metadata — no user input, no network, no runtime concurrency change. The real boundaries are: (a) the persistence **export surface** consumed by published + external packages, and (b) the **discovery** of a new test package. Both MUST-FIX live there.

## MUST FIX

### EC-1: Deprecated `./internal/persistence` alias would silently drop internal-only symbols
- **Affected task:** T3.2
- **Kind:** NEGATIVE (back-compat break for external consumers)
- **Family:** Format / Contract
- **Scenario:** The plan's T3.2 says convert `internal/persistence/index.ts` to "re-export `*` from the public barrel". But `./internal/persistence` currently exports a **superset** of `./persistence`: `appendJsonl`, `loadJsonl`, `readJsonlIds`, `createExclusive`, `CreateExclusiveOptions`, `casUpdate`, `getTheokitHome`, `getProfilesRoot`, `displayTheokitHome`, `containsCjk` are on `internal` but NOT on the public barrel (grep-verified). Re-exporting only the public barrel would REMOVE these from the alias.
- **Impact:** Any external consumer importing e.g. `createExclusive` / `appendJsonl` / `getTheokitHome` from `@theokit/sdk/internal/persistence` breaks silently at their next install — the exact "silent consumer break" the DoD forbids.
- **Suggested fix:** Do NOT shrink the alias. Keep `internal/persistence/index.ts` exporting **everything it does today** (unchanged export list) and only add an `@deprecated` JSDoc banner pointing to `./persistence`. Back-compat is then 100% preserved. (The 13 satellite src sites still migrate to `./persistence` for the 7 symbols that barrel now covers — that part of T3.2 is unaffected and already correct.)

### EC-2: New test-only package could be created but silently not execute the 4 tests → false green before devDeps are removed
- **Affected task:** T2.1
- **Kind:** NEGATIVE (false-negative test coverage)
- **Family:** State / Discovery
- **Scenario:** `pnpm-workspace.yaml` globs `packages/*`, so a new `packages/sdk-peer-integration-tests` IS auto-discovered — but if its `test` script is missing/mis-wired, or turbo's pipeline doesn't include it, the 4 relocated tests could report "0 tests" while the suite stays green. If sdk's devDeps are removed at the same time, real coverage is lost with no red signal.
- **Impact:** The BYO-memory peer contract loses its regression net; a future peer-loader break ships undetected.
- **Suggested fix:** Add a hard gate to T2.1: **assert the 4 tests execute + pass in the new package BEFORE removing sdk's 2 devDeps** — `pnpm --filter @theokit/sdk-peer-integration-tests test` must report ≥ 4 passing tests (not "no tests found"). Only then delete the devDeps. Sequence the removal as a distinct step after the green assertion.

## SHOULD TEST

### EC-3: Peer-range floor edit must preserve any existing range structure
- **Affected task:** T1.1
- **Kind:** EDGE (boundary of valid range syntax)
- **Suggested test:** `peer_range_floors_all_at_least_v4()` — parse each of the 5 `peerDependencies["@theokit/sdk"]`; assert the **floor** semver ≥ 4.0.0 regardless of upper bound. Baseline shows bare `>=1.7.0` (no upper bound), so result is bare `>=4.0.0`; the test guards against a hand-edit that corrupts the range string.

### EC-4: Runtime module moves must keep the public `.d.ts` surface byte-stable AND keep knip green
- **Affected task:** T4.1, T4.2, T4.3
- **Kind:** NEGATIVE (accidental public-API drift / orphan barrel)
- **Suggested test:** (a) `diff` the built public `dist/*.d.ts` barrels before/after each move — assert byte-identical (no public-API change, a hard DoD). (b) `pnpm quality:dead` (knip) green — the new `internal/{session,cloud-agent,local-agent}/index.ts` barrels must be actually consumed by their importers (routed through in the REFACTOR step), else knip flags them orphan.

## DOCUMENT

### EC-5: Widening peer floors could theoretically reject a satellite that still supports old sdk
- **Kind:** NEGATIVE (over-tightening)
- **Accepted risk:** The 5 satellites import v4-only surfaces (`./internal/persistence`, etc.), so `>=1.7.0` was already a lie. Tightening to `>=4.0.0` cannot reject a valid consumer — any consumer on old sdk was already broken. `pnpm install --frozen-lockfile` in Phase 5 confirms resolution. No action needed.

## Summary

| Task | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|------|------|----------|----------|-------------|----------|
| T1.1 | 1 | 1 | 0 | 1 | 1 |
| T2.1 | 0 | 1 | 1 | 0 | 0 |
| T3.1 | 0 | 0 | 0 | 0 | 0 |
| T3.2 | 0 | 1 | 1 | 0 | 0 |
| T4.1–T4.3 | 0 | 1 | 0 | 1 | 0 |
| T4.4 | 0 | 0 | 0 | 0 | 0 |

**Coverage check:** the persistence-surface boundary (T3.2) and the test-discovery boundary (T2.1) both have NEGATIVE cases covered; the version-range boundary (T1.1) has both lenses. Internal module moves (T4.x) are pure relocation — the only real risk is public-surface drift (covered by EC-4).

**Verdict:** PLAN NEEDS ADJUSTMENT — absorb EC-1 (alias must preserve full internal surface) and EC-2 (assert relocated tests run before removing devDeps) into the plan as v1.1.
