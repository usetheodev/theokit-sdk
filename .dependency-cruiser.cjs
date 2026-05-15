// Dependency-cruiser config — enforces Quality Gates G6 (no cycles) and
// G7 (layered architecture). See .claude/quality-gates.md.

module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment:
        "G6: Circular dependencies are forbidden. Break the cycle by extracting a shared type or interface.",
      from: {},
      to: { circular: true },
    },
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
          "(^|/)packages/sdk/src/types/",
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
