# Diagnosis — npm release pipeline broken (why npm is not updated)

**Date:** 2026-06-15 · **Mode:** read-only diagnosis (no code changed) · **Trigger:** "Atualize nosso NPM"

## TL;DR
npm is stuck at `@theokit/sdk@1.8.1` / `@theokit/di@0.1.0` / `@theokit/di-agent@0.1.0` because the **official publish path (CI `release.yml`) has failed on every merge to `main` (#5–#9)** — it aborts at `pnpm build` due to a **turbo build-graph cycle**, long before `changeset publish` runs. A separate **changesets 0.x→1.0.0 cascade** would also produce wrong versions. Local manual publish is not the intended path (OIDC-provenance-only by design).

## CORRECTION (2026-06-15, during implementation) — the real Phase-A fix is one line

The diagnosis below proposed removing `@theokit/sdk`'s devDeps + relocating cross-package tests (Finding 2, Option 1). **That was over-scoped.** On implementing, the actual committed `turbo.json` already had per-package build overrides (`@theokit/sdk#build.dependsOn: []`, `@theokit/sdk-memory#build.dependsOn: []`). `sdk#build: []` already breaks the cycle from sdk's side. The *real* defect: `@theokit/sdk-memory#build.dependsOn: []` removed the legitimate one-way ordering `sdk-memory → sdk`, so on a clean checkout `sdk-memory` (tsc) ran before `@theokit/sdk/dist` existed → `TS2307`. `sdk-handoff` had NO override → used default `^build` → correctly ordered after `sdk#build` (which is why CI only failed on `sdk-memory`, not `sdk-handoff`).

**Fix applied:** `@theokit/sdk-memory#build.dependsOn` `[]` → `["@theokit/sdk#build"]`. Verified: `npx turbo run build --dry=json` shows the edge; a clean build with `sdk/dist` absent succeeds (sdk builds first); `peer-parity.test.ts` stays GREEN (5/5). NO devDep removal, NO test relocation, NO public-surface change. The pnpm "Circular package dependency detected" warning is cosmetic/non-fatal (turbo executes the acyclic *task* graph). Findings 3 (changeset cascade) and 4 (OIDC-only publish) stand unchanged.

## Finding 1 — CI release has been failing silently (root blocker)
- `.github/workflows/release.yml` triggers on `push: branches: [main]` → `changesets/action@v1` (`pnpm changeset version` / `pnpm changeset publish`) with **OIDC trusted publisher** (`id-token: write`); NPM_TOKEN intentionally unused.
- `gh run list --workflow release.yml`: PRs #5,#6,#7,#8,#9 merges → **all `failure`** (~1 min each).
- Failed step = `pnpm build` (turbo). Error (PR #9 run `27557828012`):
  ```
  WARNING Circular package dependency detected: @theokit/sdk-handoff, @theokit/sdk-memory, @theokit/sdk
  @theokit/sdk-memory#build: error TS2307: Cannot find module '@theokit/sdk' (and /errors, /internal/persistence, /path-safety)
  Failed: @theokit/sdk-memory#build  → run exits 2 → publish never runs
  ```

## Finding 2 — Root cause: a devDependency build cycle
Build-graph edges (turbo `build` has `dependsOn: ["^build"]`, which follows BOTH `dependencies` and `devDependencies`):

| Package | devDependencies (workspace) |
|---|---|
| `@theokit/sdk` | `@theokit/sdk-handoff: workspace:*`, `@theokit/sdk-memory: workspace:*` |
| `@theokit/sdk-handoff` | `@theokit/sdk: workspace:*` |
| `@theokit/sdk-memory` | `@theokit/sdk: workspace:*` |

→ cycle `sdk → sdk-handoff → sdk` and `sdk → sdk-memory → sdk`. turbo cannot topologically order → on a **clean checkout (CI)** `sdk-memory#build` (tsc) runs before `@theokit/sdk`'s `dist` exists → `TS2307`. **Masked locally** because a stale `@theokit/sdk/dist` already exists.

### Why the fix is low-risk
`@theokit/sdk`'s SRC does **not** statically import the extracted packages — it loads them at **runtime via dynamic `await import()`** with **locally-declared structural-mirror types**:
- `packages/sdk/src/agent-helpers.ts:91` → `await import("@theokit/sdk-handoff/internal/tool-injector")`
- `packages/sdk/src/internal/memory/sdk-memory-peer-loader.ts` → `await import("@theokit/sdk-memory")` (mirror interface declared locally)
- `index.ts` references are comments only.

So **building `@theokit/sdk`'s dist never needs sdk-handoff/sdk-memory built**. The cycle exists *only* because of the two `devDependencies`, which are present for **9 integration test files** in `packages/sdk/tests/` (e.g., `memory-class-peer-routing.test.ts`, `peer-parity.test.ts`, `sdk-2-0-npm-publish-readiness.test.ts`, `memory-provider-interface.test.ts`, `codemod-1-x-to-2-0.test.ts`).

### Fix options (Phase A — pick in plan)
1. **Remove `@theokit/sdk`'s two `devDependencies` + relocate the 9 cross-package integration tests** to the downstream packages (sdk-handoff/sdk-memory) or a dedicated e2e workspace. Cleanest; breaks the cycle at the source (sdk must not depend on its own downstream — mirrors ADR 0001 cycle-break discipline).
2. Keep devDeps but exclude them from the **build** task graph (turbo has no clean per-edge exclusion; would need a separate test-only package or task topology). More complex, less idiomatic.
3. Validate any fix with a **clean-checkout build**: `rm -rf packages/*/dist && pnpm build` must succeed (reproduces CI).

## Finding 3 — Secondary: changesets 0.x → 1.0.0 cascade (separate issue)
`changeset status --verbose` with correct gap changesets (sdk minor, di patch, di-agent minor) plans:
- `@theokit/sdk 1.9.0` (minor, correct), `@theokit/di 0.1.1` (patch, correct)
- **`@theokit/di-agent`, `@theokit/gateway`, all `gateway-*`, `sdk-budget`, `sdk-cache`, `sdk-handoff`, `sdk-memory`, `sdk-tools` → `1.0.0` (MAJOR)** — wrong.
- Dep declarations are mixed: `gateway` uses `@theokit/sdk: workspace:^`; `sdk-cache`/`sdk-budget` use `>=1.7.0`. Both end at 1.0.0, so it is not purely a workspace: artifact.
- Root cause **not yet pinned** — likely changesets pre-1.0 bump-magnitude behavior + `updateInternalDependencies: "patch"` + dependent-bump interaction. Needs a focused Phase B investigation. This is independent of the build cycle and would mis-version 16 packages even after Phase A.

## Finding 4 — Publish requires CI (OIDC), not local
`publishConfig: { provenance: true }` on all three target packages + `release.yml` OIDC trusted-publisher. A local `pnpm publish` cannot attest provenance (CI-only) — using `--no-provenance` would publish unattested packages, undermining the maintainer's deliberate supply-chain posture (NPM_TOKEN intentionally avoided). **Conclusion: publishing must go through the fixed CI path.**

## Proposed plan (for approval — scope)
- **Phase A (unblocks CI):** break the devDependency build cycle (Option 1) + verify with a clean-checkout build. After this, a merge to `main` lets `release.yml` build successfully.
- **Phase B (correct versions):** pin + fix the changesets 0.x→major cascade so dependents get patch/minor (not 1.0.0). Create the 3 gap changesets (sdk minor / di patch / di-agent minor).
- **Then:** merge to `main` → `release.yml` (`changeset version` PR → merge → `changeset publish` with OIDC) updates npm correctly.
- Each phase via the cycle (discover→plan→implement→review). No local publish.

## State after diagnosis
Working tree pristine (all experiments reverted). Nothing built, versioned, or published. npm unchanged.
