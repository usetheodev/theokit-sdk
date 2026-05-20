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
    setupFiles: ["./vitest.setup.ts"],
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
