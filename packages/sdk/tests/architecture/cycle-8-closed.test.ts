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
import { describe, expect, it } from "vitest";
import { cycleLines, madgeCircularReport } from "./madge-report.js";

describe("Architecture — Cycle #8 closure (T3.1 / D431)", () => {
  it("madge --circular reports NO cycle containing agent-registry.ts AND agent-registry-store.ts", () => {
    // Find every cycle line (madge prints one cycle per line after "Found N circular dependencies!").
    const lines = cycleLines(madgeCircularReport());
    // A cycle is reported as a single line listing nodes separated by ">".
    // We're searching for any cycle that contains BOTH file names.
    const offending = lines.filter(
      (line) => line.includes("agent-registry.ts") && line.includes("agent-registry-store.ts"),
    );
    expect(
      offending,
      `Expected no cycle containing both agent-registry.ts and agent-registry-store.ts. Found:\n${offending.join("\n")}`,
    ).toEqual([]);
  }, 90_000);
});
