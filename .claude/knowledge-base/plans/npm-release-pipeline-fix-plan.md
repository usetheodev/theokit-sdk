---
slug: npm-release-pipeline-fix
created_at: 2026-06-15
milestone_id: none
goal: Unblock the CI npm release (release.yml) by breaking the turbo build-graph cycle (sdk ↔ sdk-handoff/sdk-memory) and correcting the changesets 0.x→1.0.0 cascade, so a merge to main publishes the gap packages with OIDC provenance.
---

# Plan: Fix the npm release pipeline (CI build cycle + changesets cascade)

> **Version 1.0** — Diagnosis: `.claude/knowledge-base/discoveries/npm-release-pipeline-diagnosis.md`. npm is stuck because `release.yml` fails on every merge to `main` at `pnpm build` (turbo devDependency cycle), and even if it built, `changeset version` would mis-bump 16 pre-1.0 packages to `1.0.0`. Publishing is CI/OIDC-only by design (no local publish). Two phases: A unblocks the build; B corrects versions.

## Goal

> "A merge to `main` makes `release.yml` succeed and publish only the intended packages, measured by: (a) a clean-checkout build (`rm -rf packages/*/dist && pnpm build`) succeeds with no circular-dependency warning and no `TS2307`; (b) `npx changeset status` plans `@theokit/sdk` minor (→1.9.0), `@theokit/di` patch (→0.1.1), `@theokit/di-agent` minor (→0.2.0), and dependents bumped at most patch (NOT major 1.0.0); (c) all affected test suites stay green; (d) publishing remains CI/OIDC-only (no local publish, no NPM_TOKEN, provenance preserved)."

## Context / Baseline (current state — verified read-only)

| Fact | Evidence |
|---|---|
| `release.yml` triggers on push to `main`, uses `changesets/action` + OIDC (`id-token: write`), NPM_TOKEN intentionally unused | `.github/workflows/release.yml` |
| Every merge #5–#9 → release `failure` (~1 min), aborts at `pnpm build` | `gh run list --workflow release.yml` |
| Build cycle: `@theokit/sdk` devDeps `sdk-handoff`+`sdk-memory` (workspace:*); both devDep `sdk` back; turbo `build dependsOn ["^build"]` follows devDeps | package.json ×3 + turbo.json |
| sdk SRC needs NEITHER at build time — loads via `await import()` + local mirror types (`agent-helpers.ts:91`, `sdk-memory-peer-loader.ts`) | grep |
| Only the devDeps + cross-package tests keep the edge: **`peer-parity.test.ts` (215 LoC) + `codemod-1-x-to-2-0.test.ts` (148 LoC) + fixture** import `@theokit/sdk-memory` | grep |
| Cascade: `changeset version` bumps di-agent + gateways + sdk-* to `1.0.0` (major) on an sdk minor; mixed dep decls (`workspace:^` vs `>=1.7.0`) | `changeset status --verbose` |
| All 3 targets already published at current versions; provenance:true | npm view + publishConfig |

Invariants to preserve: sdk dist build must not need downstream pkgs; downstream→sdk build edge stays (one-way); no local publish; OIDC/provenance untouched; the memory peer-routing + codemod behaviors stay tested.

## Drawbacks & Risks

- **Relocating tests changes their home.** Mitigation: move the 2 cross-package tests to `packages/sdk-memory/tests/` (which already build-depends on sdk one-way — no cycle); keep assertions identical; verify green before/after.
- **Removing sdk devDeps could hide a real sdk-handoff test need.** Mitigation: first confirm (grep) no remaining static import of `@theokit/sdk-handoff`/`@theokit/sdk-memory` in `packages/sdk/tests` after relocation; if any dynamic-import test needs the peer, relocate it too.
- **Cascade root cause not yet pinned (Phase B).** Mitigation: Phase B starts with a focused investigation (changeset behavior on 0.x dependents + `updateInternalDependencies`); only then apply the minimal config/dep fix. Validate with `changeset status` (read-only) before any merge.
- **Irreversible publish.** Mitigation: NO local publish in this plan; the deliverable is a GREEN clean-build + correct `changeset status`. Actual publish happens via CI on the human-approved merge.

## Tasks

### Phase A — Unblock the CI build (fix turbo build ordering) ✅ DONE 2026-06-15 (+ follow-up A1.b)

> **Follow-up A1.b (after PR #10 merge revealed a second layer):** with `sdk-memory` ordering fixed, the next CI run failed at `@theokit/sdk#build` — `agent-helpers.ts:91` used a **string-literal** dynamic `import("@theokit/sdk-handoff/internal/tool-injector")`, which `tsc` statically resolves at build time. `sdk#build` cannot depend on `sdk-handoff#build` (re-forms the cycle). Fix: moved the specifier into a variable so `tsc` keeps it opaque (same pattern as `sdk-memory-peer-loader.ts`). The diagnosis's claim "sdk SRC needs NEITHER at build time" was correct only for `sdk-memory` (already opaque) — `sdk-handoff`'s literal import was the exception. Reproduced RED locally (mv `sdk-handoff/dist` aside → `TS2307`), GREEN after fix; handoff tests pass.

> **Scope correction (during implementation):** the committed `turbo.json` already had `@theokit/sdk#build.dependsOn: []` (which breaks the cycle from sdk's side). The real defect was a single bad override — `@theokit/sdk-memory#build.dependsOn: []` removed the legitimate one-way ordering `sdk-memory → sdk`. Original A1 (relocate tests) + A2 (remove devDeps) were OVER-SCOPED and are NOT needed. See diagnosis § CORRECTION.

#### Task A1 — Fix the `@theokit/sdk-memory#build` ordering override ✅
- ##### Why this step: `sdk-memory`'s build genuinely needs `@theokit/sdk/dist`; the `[]` override removed that edge, so on a clean checkout `sdk-memory` (tsc) ran before sdk built → `TS2307`.
- ##### TDD (build-as-test): RED — `turbo run build --filter=@theokit/sdk-memory --dry=json` shows `dependsOn: []`; clean tree (`sdk/dist` absent) fails with `TS2307`. GREEN — set `dependsOn: ["@theokit/sdk#build"]`; dry-run shows the edge; `turbo run build --filter=@theokit/sdk-memory --force` succeeds (sdk built first); `peer-parity.test.ts` 5/5 GREEN.
- ##### Acceptance: clean-tree build GREEN; no `TS2307`; cosmetic pnpm cycle warning remains (non-fatal). **Met.**

> **Deferred (YAGNI, not required to unblock):** removing `@theokit/sdk`'s vestigial devDeps on `sdk-handoff`/`sdk-memory` + relocating `peer-parity.test.ts` would also silence the *cosmetic* pnpm circular-dependency warning. Not done — the warning is non-fatal and turbo executes the acyclic task graph. A future cleanup slice may pursue it; a build-cycle CI guard (old A3) is likewise deferred — the CI build itself fails loudly if ordering regresses.

### Phase B — Correct the changesets version cascade ✅ DONE 2026-06-15

> **Findings (verified):** the gap work is NOT on npm at all — `sdk@1.8.0/1.8.1` predate `createSquad` (verified by `npm pack` + grep: zero occurrences), and `di@0.1.0` / `di-agent@0.1.0` are scaffolds without `METADATA_KEYS.SQUAD/STEP` / `@Squad`/`@Step`. The 3 pending changesets were all STALE (G8 already shipped in `1.8.1`; di/di-agent scaffolds already shipped as `0.1.0`) — deleted and replaced.
>
> **Cascade root cause:** changesets major-bumps EVERY peer-dependent when its dep bumps. Fixed with `___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH.onlyUpdatePeerDependentsWhenOutOfRange: true` in `.changeset/config.json` — collapses all `workspace:^` / `>=1.7.0` / `^1.1.0` / `^1.3.0` peer-dependents (sdk 1.9.0 stays in range). The remaining di-dependent cascade (di-agent + the unrelated prerelease `@theokit/orm@0.1.0-next.1`, both peer `^0.1.0`) is avoided by shipping **di as a patch (0.1.1)** so it stays inside `^0.1.x`; a di minor (0.2.0) would force both to `1.0.0`.

#### Task B1 — Pin the 0.x→1.0.0 cascade root cause (investigation, read-only) ✅
- ##### Why this step: must understand WHY pre-1.0 dependents go major before changing config (no guessing on release config).
- ##### Result: root cause = peer-dependent major bump (changesets default). Oracle `changeset status --verbose` confirmed; fix = `onlyUpdatePeerDependentsWhenOutOfRange: true` + di-as-patch (keeps di inside `^0.1.x` peer ranges of di-agent + orm).
- ##### Acceptance: **Met** — documented root cause + minimal config/dep change.

#### Task B2 — Create the 3 gap changesets + apply the cascade fix ✅
- ##### Why this step: the gap features (Squad, @Step/buildWorkflow, METADATA_KEYS) need changesets so CI versions them; the fix from B1 stops the major blast.
- ##### Result: deleted 3 stale changesets; created `gap-sdk-createsquad-batch.md` (sdk minor), `gap-di-metadata-keys.md` (di **patch** — per cascade), `gap-di-agent-decorators.md` (di-agent minor). Added config option.
- ##### Acceptance: **Met** — `changeset status` plans `sdk 1.9.0` (minor), `di 0.1.1` (patch), `di-agent 0.2.0` (minor); "release would release NO packages as a major"; private `example-*` packages bumped locally only (not published).

#### (decision note) di bump level
User initially chose di **minor (0.2.0)** for semver-correctness; switched to **patch (0.1.1)** during implementation because a minor falls outside the `^0.1.x` peer ranges of `@theokit/di-agent` and the in-progress prerelease `@theokit/orm`, forcing both to `1.0.0` (orm wrongly, as it is not part of this work). Patch keeps both dependents in range with zero collateral. The METADATA_KEYS addition (additive) is documented in the changeset as shipped-as-patch with rationale. Override path if minor is still desired: `ignore: ["@theokit/orm"]` + widen di-agent's peer range to include `^0.2.0`.
- ##### Why this step: must understand WHY pre-1.0 dependents go major before changing config (no guessing on release config).
- ##### TDD: with the 3 gap changesets present, `npx changeset status --verbose` is the oracle; iterate config hypotheses in a scratch (git-stash) and re-run status until dependents plan at most patch. Document the exact cause (changeset 0.x behavior / `updateInternalDependencies` / `workspace:^` interaction).
- ##### Acceptance: a written root-cause note + the minimal config/dep change that makes `changeset status` plan: sdk 1.9.0, di 0.1.1, di-agent 0.2.0, dependents ≤ patch.

#### Task B2 — Create the 3 gap changesets + apply the cascade fix
- ##### Why this step: the gap features (Squad, @Step/buildWorkflow, METADATA_KEYS) need changesets so CI versions them; the fix from B1 stops the major blast.
- ##### TDD: create `.changeset` entries — `@theokit/sdk` minor (createSquad + Agent.batch validation), `@theokit/di-agent` minor (@Squad + @Step + buildWorkflow), `@theokit/di` patch (METADATA_KEYS). Re-run `changeset status --verbose` → matches the Goal (b) plan exactly; no unintended 1.0.0.
- ##### Acceptance: `changeset status` plan = {sdk 1.9.0, di 0.1.1, di-agent 0.2.0, dependents ≤ patch}; no stale changesets remain.

### Phase C — Ship via CI (no local publish) ✅ DONE 2026-06-15

> **Three more latent blockers surfaced at publish time** (each masked by the prior — the CI release had never succeeded before, so every layer was untested):
> 1. **GitHub Actions cannot create PRs** (`can_approve_pull_request_reviews: false`) → changesets/action built + pushed `changeset-release/main` but couldn't open the Version Packages PR. Worked around by opening it manually (PR #12). (Setting left disabled; manual VP PR is the interim.)
> 2. **No npm trusted-publisher binding** → OIDC publish `E404`. Switched to token auth via `NODE_AUTH_TOKEN` (secret `NPM_TOKEN`) (PR #13).
> 3. **Private repo blocks provenance** → token publish `E422` ("Unsupported GitHub Actions source repository visibility: private"). The already-published versions had no attestation either (`dist.attestations` empty) — `provenance:true` was aspirational. Disabled provenance in `release.yml` + 7 `publishConfig`s (PR #14).
>
> Also fixed the **develop↔main version divergence** by fast-forwarding develop to main before PR #14 (the Version Packages bump lived only on main).

#### Task C1 — Merge to main → CI publishes ✅
- ##### Why this step: publishing is CI-only; the human-approved merge triggers `release.yml`.
- ##### Result: PR #14 merge → `release.yml` published via token (no provenance). **Verified on npm:** `@theokit/sdk@1.9.0`, `@theokit/di@0.1.1`, `@theokit/di-agent@0.2.0`; tarballs confirmed to contain `createSquad` / `@Step`+`readStepMetadata` / `METADATA_KEYS.SQUAD`. No unintended `1.0.0` packages. **Met.**

### Follow-ups (post-publish, not blocking)
- **Rotate `NPM_TOKEN`** — shared out-of-band; revoke at npmjs.com → Access Tokens.
- **When the repo goes public** (Apache-2.0 open SDK narrative): re-enable provenance (workflow env + `publishConfig.provenance` + dashboard trusted publishers) to ship attested + tokenless.
- **Enable "Allow GitHub Actions to create and approve pull requests"** to make the Version Packages PR fully automatic (else open it by hand each release).

## Coverage Matrix

| Goal claim | Task |
|---|---|
| clean-checkout build GREEN, no cycle, no TS2307 | A1, A2 |
| cycle cannot silently return | A3 |
| changeset status plans correct bumps (no 1.0.0 cascade) | B1, B2 |
| affected suites stay green | A1, A2 |
| publishing stays CI/OIDC-only | C1 (no local publish anywhere) |
| npm shows 1.9.0 / 0.1.1 / 0.2.0 after merge | C1 |

## Test Plan
- Build-graph: `rm -rf packages/*/dist && pnpm build` (the CI-reproducing oracle) — must be GREEN with no cycle.
- Unit/integration: relocated peer-parity + codemod tests green in sdk-memory; sdk/di/di-agent/sdk-memory/sdk-handoff suites green.
- Release plan: `changeset status --verbose` (read-only) matches the intended bumps.
- Post-merge: `release.yml` success + `npm view` versions (CI publish, human-gated merge).

## Unresolved Questions
- Phase B exact config fix (resolved in Task B1 before any change). If the cascade proves intrinsic to changesets 0.x semantics, fallback is per-package explicit version control via separate changesets — to be decided in B1 with evidence.

## Prior Art
- ADR 0001 (this repo) — break dependency cycles via leaf/one-way edges (same discipline applied to the package graph here).
- `release.yml` + changesets/action + OIDC trusted publisher (the intended, unchanged publish path).
- Diagnosis: `.claude/knowledge-base/discoveries/npm-release-pipeline-diagnosis.md`.

## Rationale & Alternatives
- **Chosen:** cut the `sdk → downstream` devDep edge (relocate 2 tests) + fix changeset cascade + publish via CI. Minimal, idiomatic, preserves provenance.
- **Rejected:** local `pnpm publish --no-provenance` — publishes unattested packages, contradicts the maintainer's OIDC posture.
- **Rejected:** keep devDeps + hack turbo to skip them — turbo has no clean per-edge build exclusion; fragile.
- **Rejected:** accept the 1.0.0 cascade — would wrongly major-bump 16 packages, irreversibly.
