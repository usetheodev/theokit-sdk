# Changelog

All notable changes to `@theokit/sdk-tools` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-06-08

### Added

- Initial extraction from `@theokit/sdk@1.7.0` `src/tools/` directory.
- Public factories:
  - `createReadFileTool({ cwd })`
  - `createListDirTool({ cwd })`
  - `createSearchTextTool({ cwd })`
  - `createGitDiffTool({ cwd })` — requires `simple-git` peer
  - `createRunVitestTool({ cwd })` — requires `vitest` peer
  - `createSubprocessTool({ cwd })`
- Path-scope helpers: `checkPathScope`.
- Security: inline `isForbiddenPath` blocklist primitive (avoid coupling to `@theokit/sdk/internal/security`).
- Peer-deps: `@theokit/sdk@>=1.7.0`, optional `simple-git` and `vitest`, `zod@^3.25.0 || ^4.0.0`.

### Notes

- `@theokit/sdk/tools` sub-path is removed in `@theokit/sdk@2.0.0`; consumers move to `@theokit/sdk-tools`.
- All 6 unit tests from `packages/sdk/tests/tools/{git-diff,list-dir,read-file,run-vitest,search-text,sub-export-smoke}.test.ts` migrated.
- Sub-export smoke test rewritten to assert the new package barrel surface.
