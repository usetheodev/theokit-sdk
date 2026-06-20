// Dependency-cruiser config — enforces Quality Gate G7 (layered architecture)
// and orphan-module detection. See .claude/quality-gates.md.
//
// T0.1 (arch-review-fixes-2026-06-06): `no-circular` rule removed.
// dep-cruiser's circular detection silently misses cycles that `madge`
// catches via the dependency-tree library (root cause: dep-cruiser's
// tsConfig parse is skipped per the documented `enhancedResolveOptions`
// rationale, which downgrades TS module resolution). madge is the canonical
// cycle gate via `pnpm run quality:cycles` (tools/check-cycles.mjs).
// Empirically observed iter-1: madge=13 cycles vs depcruise=0 violations.
// dep-cruiser remains the gate for `no-orphans` + layered architecture rules.

module.exports = {
  forbidden: [
    {
      name: "no-orphans",
      severity: "error",
      comment:
        "Orphan modules indicate dead code. Either export from a barrel or remove. (See G5 — knip also flags these.) Type-only modules under src/types/ are excluded: `export type *` re-exports are erased in JS so dep-cruiser cannot trace them, but knip + tsc together catch real dead types.",
      from: {
        orphan: true,
        pathNot: [
          "(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$",
          "\\.d\\.ts$",
          "(^|/)tsup\\.config\\.ts$",
          "(^|/)vitest\\.config\\.ts$",
          "(^|/)tests/",
          "(^|/)tools/",
          "(^|/)packages/sdk/src/internal/",
          // Per-feature internal namespaces (e.g., subscription/internal/) — same rationale as src/internal/:
          // type-only re-exports erased at JS runtime, plus knip + tsc cover dead-type detection.
          "(^|/)packages/sdk/src/[^/]+/internal/",
          "(^|/)packages/sdk/src/types/",
          // G11 auth orchestrator types (type-only exports erased at JS runtime; tsc + knip cover dead-type detection per existing rule rationale)
          "(^|/)packages/sdk/src/server/auth/types\\.ts$",
          // Sub-path module types (a2a, client, server/adapter) — imported by their barrel index.ts
          // which are tsup sub-entries. dep-cruiser cannot trace tsup entry points so marks these as orphans.
          // knip + tsc verify they are reachable.
          "(^|/)packages/sdk/src/(a2a|client|server/adapter)/types\\.ts$",
          // M1-5: `@theokit/sdk/messages` readers — a public tsup sub-entry whose only imports are
          // type-only (`import type` from types/messages + types/usage, erased at JS runtime), so the
          // module has no value-level edges and dep-cruiser marks it orphan. Reachable via the `messages`
          // tsup entry + package.json `./messages` export; knip + tsc verify it (same rationale as above).
          "(^|/)packages/sdk/src/messages\\.ts$",
        ],
      },
      to: {},
    },
    {
      name: "types-dont-import-runtime",
      severity: "error",
      comment:
        "G7: src/types/* are pure type definitions. They MUST NOT depend on runtime modules (src/agent, src/cron, src/theokit, src/errors, src/internal).",
      from: { path: "(^|/)packages/sdk/src/types/" },
      to: {
        path: "(^|/)packages/sdk/src/",
        pathNot: "(^|/)packages/sdk/src/types/",
      },
    },
    {
      name: "internal-must-not-import-facade",
      severity: "error",
      comment:
        "G7: src/internal/* is implementation detail and MUST NOT import the public Agent facade (src/agent.ts) — that inverts the public-api->internal dependency direction. Use the agent-factory-registry inversion seam (getAgentFacade) instead.",
      from: { path: "(^|/)packages/sdk/src/internal/" },
      to: { path: "(^|/)packages/sdk/src/agent\\.ts$" },
    },
    {
      name: "src-must-not-import-tests",
      severity: "error",
      comment: "G7: Production code under src/ must not import from tests/.",
      from: { path: "(^|/)packages/sdk/src/" },
      to: { path: "(^|/)packages/sdk/tests/" },
    },
    {
      name: "no-imports-from-referencia",
      severity: "error",
      comment:
        "G7: referencia/ is read-only study material; never import from it. See CLAUDE.md 'Working with referencia/'.",
      from: {},
      to: { path: "(^|/)referencia/" },
    },
    {
      name: "no-imports-from-dist",
      severity: "error",
      comment: "G7: Source and tests must import from src, not dist. dist is build output.",
      from: { path: "(^|/)packages/sdk/(src|tests)/" },
      to: { path: "(^|/)packages/sdk/dist/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: {
      path: "(^|/)(node_modules|dist|coverage|referencia)/",
    },
    // Skip tsConfig parse — dep-cruiser falls back to TS native resolution.
    // Loading tsconfig.json here would require it to resolve `extends:
    // "../../tsconfig.base.json"` from the workspace root CWD, which breaks
    // depcruise's path resolver. Native resolution is fine for our use case
    // (no path aliases, just relative imports + node_modules).
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
      mainFields: ["main", "module", "types"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
