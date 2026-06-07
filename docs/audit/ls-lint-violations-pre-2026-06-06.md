# ls-lint pre-rule dry-run snapshot — plan `arch-review-fixes-2026-06-06` T7.1

Date: 2026-06-07
Plan: T7.1 — Ship `.ls-lint.yml` + rename outliers (with dry-run audit per EC-11)
ls-lint version: v2.3.1 (Go 1.24.3)

## EC-11 absorption

Per edge-case-plan finding EC-11, `.ls-lint.yml` MUST NOT be enabled in `pnpm validate` chain until every legitimate non-conforming path is captured + classified, then either renamed (outlier) or added to `ignore:` (legitimate exception). Otherwise the CI gate will fail unrelated paths.

## Configuration applied (dry-run only — committed in T7.1 final commit)

```yaml
ls:
  packages/*/src:
    .ts: regex:^[a-z][a-z0-9-]*$
    .tsx: regex:^[a-z][a-z0-9-]*$
  packages/*/src/**:
    .ts: regex:^[a-z][a-z0-9-]*$
    .tsx: regex:^[a-z][a-z0-9-]*$
  packages/*/tests:
    .ts: regex:^[a-z][a-z0-9-]*$
  packages/*/tests/**:
    .ts: regex:^[a-z][a-z0-9-]*$

ignore:
  - node_modules     # pnpm hoist tree (workspace + nested examples)
  - dist             # build output
  - dist-runtime     # CLI runtime build
  - build            # alt build dirs
  - target           # rust convention (none here, defensive)
  - coverage         # test coverage HTML reports
  - .git             # git internals
  - .nvm             # node version manager
  - .pnpm-store      # pnpm content-addressable store
  - .changeset       # changeset metadata
  - .github          # GitHub Actions workflows + templates
  - .claude.previous.bak  # backup from prior /implement migration
  - .claude          # halt-loop + skill + agent infrastructure
  - referencia       # read-only study material per CLAUDE.md
  - docs/evalscope   # vendored external project (see .gitignore)
  - architecture-output  # /loop-architecture-review output (gitignored)
  - examples         # example apps; their own pnpm tree + naming conventions
```

## Rationale per `ignore:` entry

| Entry | Reason |
|---|---|
| `node_modules`, `.pnpm-store` | Dependency tree; not project code. |
| `dist`, `dist-runtime`, `build` | Build outputs (transpiled, possibly `.d.cts` / `.d.ts` mirrored from underscored sources). |
| `coverage` | Vitest coverage HTML report. |
| `target` | Rust convention (none here, defensive). |
| `.git`, `.nvm` | Tool internals. |
| `.changeset` | Changeset metadata uses dot-prefix files (`config.json`, `arch-fixes-*.md`). |
| `.github` | GitHub Actions workflows; uppercase + dots intentional (e.g., `CODEOWNERS`, `*.yml`). |
| `.claude.previous.bak`, `.claude` | Halt-loop infrastructure + agent/skill definitions; mixed naming (md, json, py, yml, ts). |
| `referencia` | Per `theokit-sdk/CLAUDE.md § Working with referencia/`: read-only study material; NEVER touch. |
| `docs/evalscope` | Vendored external project (1645 files, own naming conventions). Per `.gitignore`. |
| `architecture-output` | `/loop-architecture-review` output (SQLite + SVGs + ADR drafts); reproducible artifact, not project code. |
| `examples` | Example apps each have their own `pnpm install` tree + naming conventions per dogfood demo. Out of T7.1 scope. |

## Pre-rename violations captured (4 outliers — exactly matches audit DB rows NV#1)

```
packages/acp/tests/_helpers.ts failed for `.ts` rules: regex:^[a-z][a-z0-9-]*$
packages/sdk/src/internal/security/_test-reset.ts failed for `.ts` rules: regex:^[a-z][a-z0-9-]*$
packages/sdk/src/tools/_path-scope.ts failed for `.ts` rules: regex:^[a-z][a-z0-9-]*$
packages/sdk/src/tools/_subprocess.ts failed for `.ts` rules: regex:^[a-z][a-z0-9-]*$
```

These match the auditor's NV#1 finding verbatim:

> NV#1 — `packages/{sdk,acp}/src/**/_*.ts` (4 files) — kebab-case, no underscore prefix → underscore-prefixed kebab — `_subprocess.ts` and 3 siblings — 4 outliers vs 1325 conforming.

## Resolution plan (T7.1 sequence)

1. ✅ EC-11 dry-run captured (this doc).
2. **Rename** all 4 files (strip leading underscore), updating imports:
   - `packages/sdk/src/tools/_subprocess.ts` → `subprocess.ts` (2 importers)
   - `packages/sdk/src/tools/_path-scope.ts` → `path-scope.ts` (2 importers)
   - `packages/sdk/src/internal/security/_test-reset.ts` → `test-reset.ts` (1 importer)
   - `packages/acp/tests/_helpers.ts` → `helpers.ts` (1 importer)
3. Verify `pnpm exec ls-lint` exits 0 + zero violations.
4. Add `validate:naming` script to root `package.json` + wire into `validate` chain.
5. Commit.

## Re-validation cadence

Each `/implement` cycle SHOULD re-run `pnpm exec ls-lint` as part of the validation gate. New underscore-prefixed files added (e.g., a future contributor not yet aware of the convention) MUST be either renamed OR added to `ignore:` with explicit rationale appended below this section.

Currently NO legitimate underscore-prefixed source files exist — the 4 outliers identified by the audit are the entire population.
