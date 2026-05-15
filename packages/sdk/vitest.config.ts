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
      reporter: ["text", "lcov"],
      include: ["src/**"],
      exclude: ["src/**/*.d.ts", "src/types/**", "src/**/types.ts"],
    },
  },
});
