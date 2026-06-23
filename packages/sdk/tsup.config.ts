import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    errors: "src/errors.ts",
    cron: "src/cron.ts",
    // M1-5: SDKMessage readers — leaf-type-only deps; DTS via tsc (tsconfig.tools-dts.json).
    messages: "src/messages.ts",
    // M2-1: compaction helpers reach internal/runtime/compression → DTS via tsc (like retry/concurrency).
    compaction: "src/compaction.ts",
    // M2-4: model-capabilities catalog — leaf module; DTS via tsc (tsconfig.tools-dts.json).
    models: "src/models.ts",
    // M4-1: skills discovery + <skills> block — reaches internal/runtime/skills; DTS via tsc.
    skills: "src/skills.ts",
    // M4-2: project-instruction reader/writer — reaches internal/runtime/context; DTS via tsc.
    project: "src/project.ts",
    // M4-6: subagent tool scoping — reaches internal/runtime/skills+concurrency; DTS via tsc.
    subagents: "src/subagents.ts",
    // tools — EXTRACTED to @theokit/sdk-tools (SDK 2.0 split, Phase 5).
    "path-safety": "src/path-safety.ts",
    // M0-2: concurrency reaches into internal/runtime, so its DTS is generated
    // via tsc (tsconfig.tools-dts.json), NOT rollup-plugin-dts (cycle).
    concurrency: "src/concurrency.ts",
    // M0-3: retry reaches into internal/runtime, DTS via tsc (see concurrency).
    retry: "src/retry.ts",
    // V2-3: persistence helpers re-export internal/persistence; DTS via tsc (see concurrency/retry).
    persistence: "src/persistence.ts",
    "task-store": "src/task-store.ts",
    workflow: "src/workflow.ts",
    eval: "src/eval.ts",
    "server/auth/index": "src/server/auth/index.ts",
    "server/errors-envelope": "src/server/errors-envelope.ts",
    "subscription/index": "src/subscription/index.ts",
    "a2a/index": "src/a2a/index.ts",
    "client/index": "src/client/index.ts",
    "sandbox/index": "src/sandbox/index.ts",
    // EC-1 absorbed (SDK 2.0 plan T1.1): internal/persistence + internal/plugins
    // are publicly accessible sub-paths used by extracted packages (sdk-memory,
    // sdk-cache, sdk-handoff) for shared persistence primitives and the plugin
    // contract. Documented as "internal API — semver-exempt" in README.
    "internal/persistence/index": "src/internal/persistence/index.ts",
    "internal/plugins/index": "src/internal/plugins/index.ts",
    "internal/observability/index": "src/internal/observability/index.ts",
    "internal/security/index": "src/internal/security/index.ts",
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
      "server/auth/index": "src/server/auth/index.ts",
      "server/errors-envelope": "src/server/errors-envelope.ts",
    },
  },
  // Note: `subscription/index` DTS generated via tsc (onSuccess) — see tsconfig.tools-dts.json.
  // Mirrors tools/ + path-safety pattern to avoid rollup-plugin-dts cycle issues.
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  outDir: "dist",
  target: "node22",
  platform: "node",
  // Native + optional peer deps that must not be inlined — they require
  // runtime resolution against the host's node_modules.
  external: ["@lancedb/lancedb", "better-sqlite3", "node:sqlite", "sqlite-vec", "ws"],
  outExtension({ format }) {
    return { js: format === "esm" ? ".js" : ".cjs" };
  },
  // Generate tools/*.d.ts via tsc (rollup-plugin-dts limitation workaround).
  // Then mirror the resulting `.d.ts` into `.d.cts` so the CJS condition in
  // package.json `exports` resolves to a real `.d.cts` (eliminates attw's
  // "Masquerading as ESM" warning for `@theokit/sdk/tools` + `/path-safety`).
  onSuccess: "tsc --project tsconfig.tools-dts.json && node scripts/mirror-dts-to-cts.mjs",
});
