---
"@theokit/sdk": patch
---

Dead-code cleanup (evidence-based review, 2026-07-09).

- Removed 8 dead files: 6 unused barrels (`internal/{error-mappers,tool-dispatch,tool-registry,workflow}/index.ts`, `server/adapter/index.ts`, `internal/observability/index.ts`) whose members are reached via direct imports, plus `internal/runtime/hooks/hooks-loader.ts` (`loadProjectHooks` had zero callers) and `internal/observability/context.ts` (only reachable via the now-removed barrel). The live `internal/observability/tracer-loader.ts` is untouched (3 direct importers).
- Removed two dead public sub-path exports: `@theokit/sdk/internal/plugins` and `@theokit/sdk/internal/observability` (both `@internal`, semver-exempt, zero consumers across the monorepo). The plugin contract (`definePlugin`/`Plugin`) remains exported from the main entry — the sub-path was superseded (see `src/index.ts`); `internal/plugins/index.ts` stays as an internal relative import.

No behavior change — typecheck + build green; full test suite delta neutral (pre-existing flaky init-claude/oauth failures unchanged). See `DEAD-CODE-REVIEW-2026-07-09.md` for the full 3-layer review and the remaining phased plan.
