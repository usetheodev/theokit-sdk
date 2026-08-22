import { defineConfig } from "vitest/config";

import { ROADMAP_ONLY_SUITES, SHARED_TEST_OPTIONS } from "./vitest.config.js";

// Roadmap config — runs EXACTLY the suites the default `pnpm test` gate holds out, and
// nothing else. Invoke from the repository root with `pnpm test:roadmap`.
//
// Two defects fixed here on 2026-08-19 (B-048), both of which made this command's output
// unusable as a count of outstanding work:
//
//  1. The include list was hand-written (`tests/contract/**\/*.contract.test.ts` plus
//     `tests/golden/**\/*.golden.test.ts`) and did not match what the default gate
//     excluded. It pulled in ~10 golden files the default gate already runs green, and
//     it missed `tests/contract/error-codes.test.ts` and
//     `tests/contract/registered-agent.test.ts` entirely — those two matched the old
//     `tests/contract/**` exclusion but not this include, so nothing ran them. It now
//     imports the exclusion list itself, which makes drift structurally impossible.
//
//  2. It declared no `setupFiles`, so these suites ran without the per-test THEOKIT_HOME
//     isolation (ADR D60) and without the native-bindings preflight that every other run
//     gets. Failures caused by the missing setup were indistinguishable from real
//     outstanding work. It now shares `SHARED_TEST_OPTIONS` with the default gate, so the
//     only difference between the two runs is WHICH files run.
//
// When a suite turns green, delete its path from `ROADMAP_ONLY_SUITES` in
// vitest.config.ts. That single edit gates it by default and drops it from this run.
export default defineConfig({
  test: {
    ...SHARED_TEST_OPTIONS,
    include: ROADMAP_ONLY_SUITES,
    exclude: ["**/node_modules/**"],
  },
});
