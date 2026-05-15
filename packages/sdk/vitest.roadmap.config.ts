import { defineConfig } from "vitest/config";

// Roadmap config — runs the RED contract + golden suites that are excluded
// from the default `pnpm test` gate. Use `pnpm test:roadmap` for visibility
// into the outstanding-work backlog.
//
// When a runtime adapter ships and a suite turns green:
//   1. Remove its path from `vitest.config.ts` `test.exclude`.
//   2. The suite now runs under default `pnpm test` (G4).
//   3. Update this file if you also want to scope `test:roadmap` differently.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/contract/**/*.contract.test.ts", "tests/golden/**/*.golden.test.ts"],
    exclude: ["**/node_modules/**", "tests/golden/hygiene.golden.test.ts"],
  },
});
