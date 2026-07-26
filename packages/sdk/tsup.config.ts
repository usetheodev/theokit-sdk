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
    // Public tool-input sanitization primitive — leaf module (zod type-only + node:module +
    // lazy jsonrepair); DTS via tsc (tsconfig.tools-dts.json), mirrors the subscription pattern.
    "sanitize/index": "src/sanitize/index.ts",
    // M42 — auth subsystem sub-entry (DTS via tsc; rollup-dts cannot bundle it into `.`).
    "auth/index": "src/auth/index.ts",
    "a2a/index": "src/a2a/index.ts",
    "client/index": "src/client/index.ts",
    "sandbox/index": "src/sandbox/index.ts",
    "filesystem/index": "src/filesystem/index.ts",
    "interactive/index": "src/interactive/index.ts",
    // internal/persistence is a publicly accessible sub-path used by extracted
    // packages (sdk-memory, sdk-cache) for shared persistence primitives.
    // Documented as "internal API — semver-exempt" in README. The plugin
    // contract (definePlugin/Plugin) is exposed from the main `.` entry, NOT a
    // sub-path (see src/index.ts) — the former `internal/plugins` +
    // `internal/observability` sub-paths were removed (dead public surface,
    // 2026-07-09 dead-code review): `internal/plugins/index.ts` stays as an
    // internal relative import; `internal/observability` is reached via the
    // live `tracer-loader.ts` directly, its barrel was dead.
    "internal/persistence/index": "src/internal/persistence/index.ts",
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
  // M78 — `splitting: true`, e a razão é de CORRETUDE, não de tamanho.
  //
  // Com `splitting: false`, o esbuild INLINA o código compartilhado em cada entry point em vez de
  // emitir um chunk comum. `TheokitAgentError` acabava duplicado em `errors.js`, `auth/index.js`,
  // `compaction.js`, `subscription/index.js` — classes distintas com o mesmo nome. A consequência:
  //
  //     import { TheokitAgentError } from "@theokit/sdk/errors";
  //     import { CredentialError }    from "@theokit/sdk/auth";
  //     new CredentialError("x") instanceof TheokitAgentError  // => FALSE
  //
  // A cadeia de protótipos estava certa; o objeto de classe é que era outro. Isso anula toda a
  // premissa de uma hierarquia de erro única: um `catch` não consegue discriminar erro do framework
  // quando o erro atravessou um subpath diferente do usado para importar o tipo.
  //
  // O teste de paridade do M73 previu exatamente este modo de falha ("se o build inlinear o SDK, a
  // camada exporta uma CÓPIA e `instanceof` vira false silenciosamente"), mas o previu para a camada;
  // ele já acontecia aqui, entre subpaths do próprio SDK. Nenhum teste unitário pegava — todos
  // importam do fonte, onde a classe é uma só. Só a execução contra os pacotes PUBLICADOS revelou.
  //
  // Efeito colateral bem-vindo: `dist/index.js` caiu de 207.514 para 20.447 bytes, porque o que era
  // duplicado virou chunk compartilhado. O orçamento de 215.000 ficou folgado demais e merece ser
  // reapertado numa mudança própria — baixá-lo aqui misturaria duas decisões.
  splitting: true,
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
