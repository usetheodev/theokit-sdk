import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    errors: "src/errors.ts",
    cron: "src/cron.ts",
    tools: "src/tools/index.ts",
    "path-safety": "src/path-safety.ts",
    "task-store": "src/task-store.ts",
  },
  format: ["esm", "cjs"],
  // DTS for `tools/` and `path-safety` is generated via `tsc` (see onSuccess)
  // because rollup-plugin-dts trips on the `types/agent.ts ↔ fork-agent.ts`
  // import cycle whenever a sub-entry reaches into `internal/runtime` —
  // surfaces as a spurious "ForkOptions not exported" error.
  dts: {
    entry: {
      index: "src/index.ts",
      errors: "src/errors.ts",
      cron: "src/cron.ts",
    },
  },
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  outDir: "dist",
  target: "node22",
  platform: "node",
  // Native + optional peer deps that must not be inlined — they require
  // runtime resolution against the host's node_modules.
  external: ["@lancedb/lancedb", "better-sqlite3", "node:sqlite", "sqlite-vec"],
  outExtension({ format }) {
    return { js: format === "esm" ? ".js" : ".cjs" };
  },
  // Generate tools/*.d.ts via tsc (rollup-plugin-dts limitation workaround).
  // Then mirror the resulting `.d.ts` into `.d.cts` so the CJS condition in
  // package.json `exports` resolves to a real `.d.cts` (eliminates attw's
  // "Masquerading as ESM" warning for `@usetheo/sdk/tools` + `/path-safety`).
  onSuccess: "tsc --project tsconfig.tools-dts.json && node scripts/mirror-dts-to-cts.mjs",
});
