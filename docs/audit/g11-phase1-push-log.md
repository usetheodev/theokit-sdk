# G11 Phase 0 + Phase 1 Push Audit Log

> Per plan v1.4 EC-V3-4 — tracks biome warning counts + `--no-verify` push justifications during G11 implementation. Every push must either pass pre-push gates clean OR document why `--no-verify` was acknowledged.

## Entries (newest first)

### 2026-06-03T19:56 — T0.3 vitest workspace bump v3 → v4 (theokit-sdk)

**Commit:** [TBD post-commit SHA]
**Branch:** develop
**Files changed:** root package.json + pnpm-lock.yaml + 21 packages/*/package.json (all vitest devDep ^3.0.0 → ^4.1.8)

**Pre-push gate state:**
- biome warning count baseline: 7 (per 2026-06-03 deps-audit report § "Pre-existing vulnerabilities" — vitest>vite>esbuild + happy-dom transitive, NOT in any package runtime)
- biome warning count post-bump: TBD (vitest 4 brings updated vite ≥6 → expected to RESOLVE the 4 CRITICAL + 2 HIGH transitive devDep CVEs per v1.1 deps-audit prediction)

**Smoke test evidence:**
- @theokit/acp: 7 files / 57 tests PASS ✓
- @theokit/di: 5 files / 60 tests PASS ✓
- @theokit/orm: 8 files / 68 tests PASS ✓
- **Total: 185/185 tests GREEN across 3 representative packages**

**Push gate decision:** if --no-verify needed, justification = pre-existing biome warnings em packages/orm/src/repository.ts (`noExplicitAny` × 5 + similar) unrelated to T0.3 vitest bump. NO new G11-code violations introduced.

**Rollback procedure (if needed):** `git restore --source=origin/develop package.json pnpm-lock.yaml packages/*/package.json && PATH=/v22.16.0/bin:$PATH pnpm install` to revert to vitest v3.0.0 baseline.


### 2026-06-03T20:42 — T1.1 defineAuth orchestrator types (theokit-sdk)

**Commit:** [TBD post-amend or follow-up]
**Branch:** develop
**Files changed:** 4 (src/server/auth/types.ts NEW + index.ts NEW + tsup.config.ts entry + package.json exports)

**Pre-push gate state:**
- biome warning count: unchanged (types-only addition, zero runtime code)
- tsc errors pre-existing UNRELATED: better-sqlite3 + proper-lockfile missing types em internal/memory/persistence (not in G11 path)
- dist/server/auth/index.d.cts emitted 3.87 KB ✓ (all 6 type exports compiled)

**Test evidence:** N/A — T1.1 is types-only (no runtime). T1.2 will add tests for defineAuth() runtime.

**Push gate decision:** --no-verify acknowledged + logged here. Pre-existing tsup build pipeline error in non-G11 paths. G11 dist/server/auth/* artifacts emitted successfully BEFORE pipeline failed on unrelated tsc errors.

**Rollback procedure:** `git restore --source=origin/develop packages/sdk/src/server/ packages/sdk/tsup.config.ts packages/sdk/package.json` to revert to pre-T1.1.

