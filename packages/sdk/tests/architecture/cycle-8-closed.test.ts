/**
 * T3.1 — Cycle #8 closure verification (RED-then-GREEN architecture test).
 *
 * Plan: arch-review-fixes-2026-06-06 § Phase 3 / T3.1 (ADR D431)
 *
 * Verifies via `madge --circular` that the 2-node runtime cycle
 * `internal/runtime/agent-registry.ts ↔ internal/runtime/agent-registry-store.ts`
 * (HIGH severity, Phase 5 cartographer cycle #8) is closed after the
 * `agent-registry-contract.ts` leaf-types extraction.
 *
 * The test spawns madge as a child process (no dynamic import of madge —
 * it's a CLI-shaped library; spawn keeps the test isolated and resilient
 * to future API drift).
 *
 * Pre-T3.1: madge reported a cycle containing both files.
 * Post-T3.1: madge MUST NOT report any cycle containing both files.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Run madge --circular over packages/sdk/src and return the raw output.
 * Madge exits non-zero when cycles exist; that's expected here while other
 * tasks (T1.1 / T2.1 / T4.1) are still pending. We assert on the textual
 * report content, not the exit code.
 */
function runMadge(): string {
  // Resolve repo root from this test file location.
  // T4.1 follow-up: was `"../../../../.."` (5 ups → meta-repo `theokit-tools`,
  // no pnpm workspace) → `pnpm exec madge` errored out → test passed vacuously.
  // 4 ups lands at the `theokit-sdk` workspace root where madge runs correctly.
  const repoRoot = resolve(__dirname, "../../../..");
  const target = "packages/sdk/src";
  const result = spawnSync(
    "pnpm",
    ["exec", "madge", "--circular", "--extensions", "ts,tsx", target],
    { cwd: repoRoot, encoding: "utf8", timeout: 60_000 },
  );
  // Combined stdout for substring matching (madge prints the report to stdout).
  return (result.stdout ?? "") + (result.stderr ?? "");
}

describe("Architecture — Cycle #8 closure (T3.1 / D431)", () => {
  it("madge --circular reports NO cycle containing agent-registry.ts AND agent-registry-store.ts", () => {
    const output = runMadge();
    // Find every cycle line (madge prints one cycle per line after "Found N circular dependencies!").
    const cycleLines = output.split("\n").filter((line) => /^\d+\)/.test(line.trim()));
    // A cycle is reported as a single line listing nodes separated by ">".
    // We're searching for any cycle that contains BOTH file names.
    const offending = cycleLines.filter(
      (line) => line.includes("agent-registry.ts") && line.includes("agent-registry-store.ts"),
    );
    expect(
      offending,
      `Expected no cycle containing both agent-registry.ts and agent-registry-store.ts. Found:\n${offending.join("\n")}`,
    ).toEqual([]);
  }, 90_000);
});
