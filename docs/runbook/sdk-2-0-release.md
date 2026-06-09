# SDK 2.0 release runbook

Operator playbook for executing the SDK 2.0 cutover: Phase 6
(rename `@theokit/sdk` → `@theokit/sdk-core`) + Phase 7 (cohort
bump 21 dependent packages) + dogfood QA.

This runbook assumes Phase 1-5 are DONE (5 sub-packages exist;
hybrid dual-copy preserved) and Stage 4 routing is wired (iter 76-80).

## TL;DR

```bash
# 1. Pre-flight (read-only)
node scripts/phase6-rename-dry-run.mjs        # 398+ files in scope
node scripts/phase7-cohort-analysis.mjs       # 51 consumers + spec histogram
node scripts/phase7-peerdep-bump.mjs          # 7 packages need version bump

# 2. Apply rename + peerDep bump (mechanical mutations)
node scripts/phase6-rename-write.mjs --write --backup
node scripts/phase7-peerdep-bump.mjs --write --backup

# 3. Bump sdk-core to 2.0.0 (manual edit)
$EDITOR packages/sdk/package.json   # version: 2.0.0
$EDITOR packages/sdk/CHANGELOG.md   # new section

# 4. Install + validate
pnpm install
pnpm -r build
pnpm -r test

# 5. Commit + tag
git add -A
git commit -m "release: SDK 2.0.0 cohort cutover"
git tag v2.0.0

# 6. Publish cohort (sdk-core first, then sub-packages)
pnpm --filter @theokit/sdk-core publish
pnpm --filter "@theokit/sdk-memory" --filter "@theokit/sdk-budget" \
     --filter "@theokit/sdk-cache" --filter "@theokit/sdk-handoff" \
     --filter "@theokit/sdk-tools" publish

# 7. Dogfood QA
cd ../theokit && pnpm install @theokit/sdk-core@^2.0.0
pnpm test
```

## Step-by-step

### Step 1 — Pre-flight (read-only scope check)

Run each tool. Each is non-destructive; each prints what WOULD change.

#### 1a. Rename scope

```bash
node scripts/phase6-rename-dry-run.mjs
```

Expected output:

- Header `# Phase 6 rename dry-run report`
- Sections: `package.json declarations`, `source import specifiers`,
  `documentation references`
- Summary: ~398 files would be touched.

Inspect the package.json list. Verify the sdk-core package itself is
included (the package being renamed) plus every workspace consumer.
Verify the source import list does NOT include `@theokit/sdk-memory`,
`@theokit/sdk-budget`, etc. (negative-lookahead invariant).

#### 1b. Cohort state

```bash
node scripts/phase7-cohort-analysis.mjs > /tmp/cohort.json 2> /tmp/cohort.txt
cat /tmp/cohort.txt
```

Expected:

- Consumers found: 51 (or close)
- Workspace links: 48
- External pins: 3
- peerDependencies: 23
- Version histogram across 9 distinct specs

Inspect histogram. The dominant patterns are `workspace:*`,
`workspace:^`, `file:../../packages/sdk`, `>=1.7.0`. Any
*-prerelease tag (e.g. `1.7.0-beta.1`) means the workspace
isn't release-clean — STOP and re-stabilize before continuing.

#### 1c. peerDep bump preview

```bash
node scripts/phase7-peerdep-bump.mjs
```

Expected:

- Mode: DRY-RUN
- Target version constraint: ^2.0.0
- Packages affected: 7 (sdk-memory, sdk-budget, sdk-cache,
  sdk-handoff, sdk-tools, react, di-agent)
- Each shows `from` → `to` mapping

If the affected count is anything OTHER than 7, investigate. Either
(a) a new package was added since the last release without listing
sdk in peerDependencies, or (b) one of the 7 packages has a
non-canonical version spec that was missed.

### Step 2 — Apply mechanical mutations

Run with `--backup` so .bak files exist for surgical undo if
anything goes wrong. The script reports what changed.

```bash
node scripts/phase6-rename-write.mjs --write --backup
```

Expected: ~398 files modified. Each package.json reports its
`name` field rename + dep block key renames. Each .ts file reports
hit count.

Verify with `git diff --stat | wc -l` — should be > 398. (Higher
because some files have multiple hits.)

```bash
node scripts/phase7-peerdep-bump.mjs --write --backup
```

Expected: 7 packages modified. Each line shows the version
constraint changing.

**Validation gate:** `git diff packages/sdk/package.json` should
show ONLY the `name` field change (`@theokit/sdk` → `@theokit/sdk-core`).
If you see other unexpected changes, the script has a bug or
concurrent work landed — `git checkout -- packages/sdk/package.json`
and investigate before proceeding.

### Step 3 — Manual bumps

The scripts don't touch sdk-core's version field or CHANGELOG.
Those are deliberate operator edits.

#### 3a. Bump sdk-core version

```bash
$EDITOR packages/sdk/package.json
```

Change `"version": "1.x.y"` → `"version": "2.0.0"`.

#### 3b. Add CHANGELOG entry

```bash
$EDITOR packages/sdk/CHANGELOG.md
```

Add a `## 2.0.0 — YYYY-MM-DD` section at the top with:

- Header noting this is the package rename milestone.
- "BREAKING: package renamed from `@theokit/sdk` to `@theokit/sdk-core`.
  Migrate via `pnpm rename` or `sed`-based codemod."
- Link to ADR 0002 + Stage 3 source-move plan.
- List of moved subsystems: memory, budget, cache, handoff, tools.

#### 3c. Bump cohort sub-package versions (if they bump majors too)

Optional — if sub-packages also reach 1.0 or bump their own majors
alongside sdk-core's 2.0, edit each `packages/sdk-*/package.json`
to the new version.

### Step 4 — Install + validate locally

```bash
pnpm install
```

Watch for warnings about peer dep mismatches. If pnpm warns about
`@theokit/sdk` being orphaned, the rename was incomplete — re-run
the dry-run + investigate which files were missed.

```bash
pnpm -r build
```

All workspace packages must build. Any failure means the routing
broke; investigate the specific package.

```bash
pnpm -r test
```

All tests must pass. The Stage 4 parity gate (iter 79) catches
sdk-core ↔ sdk-memory divergence; the fallback branch test (iter 80)
catches routing-wrapper bugs.

### Step 5 — Commit + tag

```bash
git add -A
git diff --cached --stat   # sanity check the change set
git commit -m "release: SDK 2.0.0 cohort cutover

Phase 6 + 7 of the SDK 2.0 plan. Package @theokit/sdk renamed to
@theokit/sdk-core; major bumped to 2.0.0. Cohort sub-packages
(@theokit/sdk-{memory,budget,cache,handoff,tools}) bumped per
internal coordination.

BREAKING: consumers must update peerDeps from @theokit/sdk to
@theokit/sdk-core. Migration tooling: scripts/phase6-rename-write.mjs.

Plan reference: .claude/knowledge-base/plans/sdk-2-0-package-split-plan.md
"
git tag v2.0.0
git push && git push --tags
```

### Step 6 — Publish cohort

**Order matters.** sdk-core publishes FIRST so the sub-packages'
peer constraints can resolve against a real published 2.0.0.

```bash
pnpm --filter @theokit/sdk-core publish
```

Wait for the npm registry to propagate (usually < 60s; verify with
`npm view @theokit/sdk-core version`).

Then publish each sub-package. Order doesn't matter between them
because none of them depends on another sub-package's runtime —
only sdk-core.

```bash
pnpm --filter "@theokit/sdk-memory" publish
pnpm --filter "@theokit/sdk-budget" publish
pnpm --filter "@theokit/sdk-cache" publish
pnpm --filter "@theokit/sdk-handoff" publish
pnpm --filter "@theokit/sdk-tools" publish
```

**Validation gate:** after each publish, run `npm view
@theokit/<name> version` and confirm the new version landed.

If a publish fails partway through, the npm registry is now
inconsistent (some packages at v2.0.0, others at v1.x). Mitigation:

- For sdk-core: `npm deprecate @theokit/sdk-core@2.0.0 "do not use"`
  + re-publish under a patch version (`2.0.1`) with the fix.
- For sub-packages: same pattern — they're at v0.x so the cost is
  low.

Do NOT attempt to unpublish. npm's unpublish window is 72h but
breaks downstream consumers who already pulled the version.

### Step 7 — Dogfood QA

Confirm the published packages work in a fresh consumer environment.

```bash
cd ../theokit                                  # sibling project
pnpm rm @theokit/sdk
pnpm add @theokit/sdk-core@^2.0.0
pnpm test
```

The theokit sibling project's tests must pass against the new
`@theokit/sdk-core` package. Any failure means the published artifact
diverges from the workspace state — investigate.

Run the same flow against `theokit-tools`'s other consumers
(examples, CLI, etc.).

If any consumer fails, the publish is broken. Roll forward with a
patch release (`2.0.1`) — do NOT roll back.

## Recovery flows

### Phase 6 rename produced unexpected diffs

Use the `.bak` files generated by `--backup`:

```bash
find . -name "*.bak" -exec sh -c 'mv "$1" "${1%.bak}"' _ {} \;
```

This restores the pre-write state. Then re-run the dry-run to
understand the unexpected diffs.

### Phase 7 peerDep bump skipped a package

If `phase7-cohort-analysis.mjs` showed more peerDep-carrying
consumers than `phase7-peerdep-bump.mjs` reports as affected, one
of the consumers has a non-canonical version spec. Either:

- Hand-edit the package.json + re-run analysis.
- Re-run the bump tool with `--target` set to the new constraint.

### sdk-core published but a sub-package fails

Sub-package re-publish under a patch version. No need to bump
sdk-core. Update the failing package's CHANGELOG noting the patch.

### Workspace install fails after rename

Check that the npm registry has propagated the new package name.
`npm view @theokit/sdk-core version` should return `2.0.0`. If it
returns 404, wait 60s + retry. If it still 404s, the publish failed
silently — re-publish.

### Phase 6 wrote partial state mid-execution

If `phase6-rename-write.mjs` was killed mid-run (Ctrl+C, OOM, disk
full), the working tree is half-renamed and half-original. `.bak`
files exist only for the files that completed writing — files
touched without a backup are corrupted-mid-write.

Recovery uses git, NOT the .bak files (which are incomplete):

```bash
# Drop every uncommitted change including untracked .bak files.
git restore --staged .
git restore .
find . -name "*.bak" -delete

# Verify a clean tree.
git status   # should show no changes

# Diagnose the original failure (likely OOM or disk space).
df -h .
free -m

# Re-run after fixing the root cause.
node scripts/phase6-rename-write.mjs --write --backup
```

Per Unbreakable Rule 4: never use `git checkout` or `git revert`.
`git restore .` is the supported reset path.

### Operator forgot to pass --backup to Phase 6 write

`.bak` files do not exist; the working tree contains the rewritten
content with no local rollback. Use git instead:

```bash
git diff   # inspect what changed
git restore .    # discard every unstaged rewrite
```

If the rewrites were ALREADY committed, use `git reset --soft HEAD~1`
to undo the commit while keeping changes staged for review. Never
use `git reset --hard` (per Unbreakable Rule 4); `--soft` preserves
the diff so you can selectively re-stage.

### Stage 3 drift detector reports drift mid-cycle

The byte-equivalence invariant between sdk-core's `internal/memory/*`
and sdk-memory's `internal/*` copies (ADR 0002 Stage 4) only holds
when patches landing in one copy are mirrored to the other. When
the drift detector fires:

```bash
pnpm run sdk-2-0:drift
# # SDK 2.0 Stage 3 drift detector
# # ... Findings: 1
# # ## Result: FAIL — drift found.
# # ### DRIFT (1)
# #   <file>.ts ↔ <file>.ts
# #     normalized bodies differ ...
```

Apply this triage:

1. **Diff the two copies** to see WHAT changed:

   ```bash
   diff packages/sdk/src/internal/memory/<path>.ts \
        packages/sdk-memory/src/internal/<file>.ts
   ```

2. **Decide direction** (FROM → TO):
   - If the patch landed in sdk-core first (typical — security fixes
     follow the `internal/` codepath consumers already hit) → sync
     TO sdk-memory.
   - If sdk-memory shipped first (rare — sdk-memory was the testing
     ground) → sync TO sdk-core.

3. **Apply the patch** to the missing copy, preserving the iter-X
   "hybrid copy from sdk-core's …" header narration in sdk-memory
   files (they're descriptive, not load-bearing).

4. **Match declaration order** — the drift detector normalizes
   comments/imports/whitespace but NOT declaration order. If you
   add a new constant, place it at the SAME relative position as
   the source. Iter 114 hit this hazard: same constant, different
   position → detector still flagged.

5. **Re-run drift detector** to confirm 0 findings:

   ```bash
   pnpm run sdk-2-0:drift
   ```

6. **Re-run package tests** to confirm no regression:

   ```bash
   pnpm -F @theokit/sdk-memory test
   pnpm -F @theokit/sdk test
   ```

7. **Document the sync** in `@theokit/sdk-memory`'s CHANGELOG
   `[Unreleased]` under `### Security` (if security-shaped) or the
   appropriate Keep-a-Changelog category. Cite the iter where the
   patch originated. Iters 112/114/115 are the canonical pattern.

8. **If the drift is INTENTIONAL** (one copy needs a deliberately
   different impl), add the file to `KNOWN_DIVERGENCES` in
   `scripts/sdk-2-0-stage3-drift-detector.mjs` with a one-line
   rationale. NEVER allowlist a drift you haven't actively
   reviewed — silent allowlisting masks future security gaps.

### Full rollback after broken 2.0.0 publish

If 2.0.0 ships and a critical defect is discovered post-publish,
DO NOT `npm unpublish` (npm prevents within 72h anyway, and breaks
every consumer who already installed). Two recovery paths in order
of preference:

1. **Ship 2.0.1 with the fix immediately.** Bump patch, publish,
   announce in CHANGELOG. Consumers on 2.0.0 auto-resolve to 2.0.1
   on next install. This is the canonical path.

2. **Deprecate the broken version + redirect.**

   ```bash
   npm deprecate "@theokit/sdk-core@2.0.0" \
     "Critical bug: use 2.0.1 (released YYYY-MM-DD)"
   ```

   This adds a warning at every install of the deprecated version
   but does NOT remove the artifact. Consumers see the warning +
   know to bump.

If the defect is so severe that 1.x consumers must be warned away
from 2.0.x entirely, `npm deprecate "@theokit/sdk-core@2.0.0"
"Reverted; stay on @theokit/sdk@1.x until 2.1.0 ships"` and announce
across release channels. Treat as a postmortem-worthy incident.

## Known limitations

### sdk-memory: rollup-dts treeshake drops internal-type exports

`packages/sdk-memory/src/index.ts` uses `export * from "./internal/X.js"`
for every Stage 3 source-move. The runtime `.js` bundle preserves
every named export; the `.d.ts` bundle (built by `rollup-plugin-dts`
via tsup) treeshakes types that have no reachable public surface
consumer. The result: types like `ActiveMemoryCacheOptions`,
`MemorySearchHit`, `CircuitBreakerOptions`, `DiaryEntry`,
`DedupResult`, `MEMORY_EMBEDDING_ADAPTERS`, `MemoryEmbeddingProviderAdapter`,
`MemoryDb`, `isLanceAvailable`, `LanceIndex`, `SCHEMA_STATEMENTS`, etc.
ARE in the source files but DO NOT appear in `dist/index.d.ts`.

Same pattern documented inline in source files iter 48/53/55/66/
67/69/72 — those iters worked around it via "inline structural
mirror" copies in sibling files.

Symptom: `pnpm --filter @theokit/sdk-memory exec tsc --noEmit`
reports ≥ 20 `TS2305` / `TS2724` errors in
`packages/sdk-memory/tests/*.test.ts`. The test files
`import { X } from "@theokit/sdk-memory"` for treeshaken X.

**Root cause (verified iter 114):** every affected source file
carries an `@internal` JSDoc tag on either the file-level doc
comment or the type declaration itself. rollup-plugin-dts (used
by tsup for DTS bundling) respects `@internal` and strips those
exports from the published `.d.ts` even when an explicit
`export type { X } from "./internal/Y.js"` is added at the barrel
level. Iter 114 attempted the "add explicit re-export" path and
the DTS build hard-failed with:

> RollupError: "ActiveMemoryCacheOptions" is not exported by
> "src/internal/active-memory-cache.ts", imported by "src/index.ts"

The runtime `.js` bundle is unaffected — `@internal` is a dts-time
concern. Tests against the published surface still fail to typecheck.

**Pre-release fix paths (operator action, before Phase 6/7):**

Each missing symbol gets ONE of:

1. **Promote to public** — remove the `@internal` JSDoc tag from
   the source file. The type then appears in the published `.d.ts`
   and tests resolve. Trade-off: the type is permanent public API;
   future breaking changes require a semver-major bump.

2. **Keep internal, switch test imports to relative paths** —
   change `import { X } from "@theokit/sdk-memory"` →
   `import { X } from "../src/internal/Y.js"` in the test file.
   Tests still exercise the same code; they just don't pretend to
   exercise it through the published surface.

3. **Keep internal, expose via a sub-path** — add
   `"./internal/*": { types: "./dist/internal/*.d.ts", ... }` to
   sdk-memory's `package.json` exports and have tsup emit the
   internals as separate entries. Mirrors how sdk-core exposes
   `@theokit/sdk/internal/persistence`. Higher infra cost but lets
   downstream consumers (not just tests) opt into internal types.

**Why this isn't auto-fixed:** picking promote-vs-relative-vs-
sub-path per symbol is a design decision encoded by the `@internal`
tag's presence in each source file. Auto-stripping every tag would
break the iter 46 / iter 51 discipline of "kept internal until first
consumer needs it". Maintainer reviews each missing export, picks
one of the three paths, ships.

## Cross-references

- Plan: `.claude/knowledge-base/plans/sdk-2-0-package-split-plan.md`
- ADR 0002: `docs/adr/0002-sdk-memory-optional-peer-routing.md`
- Stage 3 source-move iter chain: 44-75 (38 files in sdk-memory)
- Stage 4 routing iter chain: 76-80 (24 tests across 5 files)
- Phase 6 + 7 prep iter chain: 81 (rename dry-run) + 82 (ADR) +
  83 (rename write) + 84 (cohort analysis) + 85 (peerDep bump)
- This runbook: iter 86
