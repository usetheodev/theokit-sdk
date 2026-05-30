import { defineConfig } from "vitest/config";

// Default `pnpm test` runs only green-eligible suites (smoke + golden hygiene).
// RED roadmap suites (`tests/contract/**`, `tests/golden/**/*.golden.test.ts`
// other than hygiene) are pinned specs that wait for the runtime adapters; run
// them explicitly with `pnpm test:roadmap` for visibility into outstanding work.
//
// See .claude/quality-gates.md G4 for the contract.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Autouse setup: isolates THEOKIT_HOME per-test in a fresh tmpdir
    // (T6.1, ADR D60). Tests never write to the developer's real state.
    // Also runs native-bindings preflight (T1.1, dogfood-regressions-fix v1.1).
    setupFiles: ["./vitest.setup.ts"],
    // theokit-sdk-biome-cleanup 2026-05-30 — ALL SDK tests run in the
    // forks pool with `singleFork: true` so the entire suite executes in
    // ONE subprocess sequentially. Reasons:
    //
    // 1. process.env.HOME race: tests in `internal/providers/discovery.test.ts`,
    //    `internal/runtime/context-import-resolver.test.ts`,
    //    `internal/personality/{registry,switch,resolver,store}.test.ts`,
    //    and `agent-personality-direct-api.test.ts` mutate `process.env.HOME`
    //    in `beforeEach`/`afterEach`. The threads pool (vitest default) shares
    //    one Node process across worker threads, so HOME mutations race.
    //
    // 2. libuv saturation under `pnpm -r run test` (full validate): 18
    //    packages run vitest in parallel; the threads pool's libuv worker
    //    pool gets saturated and `import()`/FS calls race nondeterministically.
    //    The forks pool (subprocess) sidesteps both classes of races.
    //
    // 3. dogfood-regressions-fix-plan v1.1 T3.1 (integration tests):
    //    integration tests with real I/O (Ollama HTTP, etc.) + long timeouts
    //    (120s) already required the forks pool. Routing the whole suite
    //    there keeps the policy uniform.
    //
    // EC-7 DOCUMENT: any new test must be process-isolation-tolerant
    // (no shared in-process state, no module cache observation, no
    // thread-only vitest mocks). singleFork=true serializes file-level,
    // so cross-file pollution can still happen if a test mutates module
    // state without resetting it in its own afterEach.
    pool: "forks",
    poolOptions: {
      forks: {
        // singleFork=false → each test file runs in its OWN subprocess. This
        // gives true env isolation: tests that mutate `process.env.HOME` in
        // beforeEach (discovery, context-import-resolver, personality/*) can
        // no longer race each other because each file has an independent
        // env. integration/* tests already accept this (D182 Ollama,
        // dogfood-regressions T3.1).
        singleFork: false,
        // Allow multiple subprocesses so the suite finishes in reasonable
        // wall-time. Each fork is its own env, so no HOME race.
        minForks: 1,
        maxForks: 4,
      },
    },
    // Force file-level serial execution. `singleFork: true` only guarantees
    // one subprocess; vitest can still parallelize test FILES inside it via
    // async scheduling. `fileParallelism: false` disables that and gives
    // strict file-level serialization, which is what the HOME-race fix
    // requires.
    fileParallelism: false,
    // Hard cap on test concurrency within a file. Defaults to 5 in vitest 3.x.
    // Combined with `fileParallelism: false` + `pool: forks` + `singleFork: true`
    // this should yield strict serial execution.
    maxConcurrency: 1,
    exclude: [
      "**/node_modules/**",
      "tests/contract/**",
      "tests/golden/agent-run.golden.test.ts",
      "tests/golden/catalog-cron-artifacts.golden.test.ts",
      "tests/golden/platform-extensions.golden.test.ts",
      "tests/golden/stream.golden.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/**"],
      exclude: [
        "src/**/*.d.ts",
        "src/types/**",
        "src/**/types.ts",
        // Telemetry adapters are gated by optional peer-deps (Langfuse,
        // Sentry, PostHog). Per ADR D42 they `safe-require` on demand and
        // no-op when the dependency is absent. Their bodies cannot run
        // under the regular test suite (peer-dep not installed); meaningful
        // coverage requires integration tests against the real package.
        // Excluding them so the threshold reflects code that CAN be unit-tested.
        "src/internal/telemetry/adapters/**",
      ],
      // S1 (quality-gates.md): soft gate. Thresholds reported as warnings
      // via `pnpm quality:coverage`; not enforced in validate today because
      // runtime-adapter coverage is still ramping. Q3 in quality-gates.md
      // tracks the move to a hard gate.
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
