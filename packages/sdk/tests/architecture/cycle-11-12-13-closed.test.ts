/**
 * T2.1 — Cycles #11 + #12 + #13 closure verification (architecture test).
 *
 * Plan: arch-review-fixes-2026-06-06 § Phase 2 / T2.1 (ADR D433)
 *
 * Verifies via `madge --circular` that the 3 HIGH memory cluster cycles
 * pivoting on `index-manager.ts` are closed after the
 * `index-manager-contract.ts` leaf-types extraction. All 3 cycles share
 * `index-manager.ts ↔ index-manager-dispatch.ts` as the load-bearing pair;
 * the contract extraction removes that edge in the types-only direction.
 */
import { describe, expect, it } from "vitest";
import { cycleLines, madgeCircularReport } from "./madge-report.js";

describe("Architecture — Cycles #11/#12/#13 closure (T2.1 / D433)", () => {
  it("madge reports NO cycle containing index-manager.ts AND index-manager-dispatch.ts (cycle #11)", () => {
    const lines = cycleLines(madgeCircularReport());
    const offending = lines.filter(
      (line) => line.includes("index-manager.ts") && line.includes("index-manager-dispatch.ts"),
    );
    expect(
      offending,
      `Expected no cycle containing both index-manager.ts and index-manager-dispatch.ts (cycles #11/#12/#13). Found:\n${offending.join("\n")}`,
    ).toEqual([]);
  }, 90_000);

  it("madge reports NO cycle containing lance-memory-adapter.ts and index-manager.ts (cycle #12)", () => {
    const lines = cycleLines(madgeCircularReport());
    const offending = lines.filter(
      (line) => line.includes("lance-memory-adapter.ts") && line.includes("index-manager.ts"),
    );
    expect(offending).toEqual([]);
  }, 90_000);

  it("madge reports NO cycle containing memory-index.ts and index-manager.ts (cycle #13)", () => {
    const lines = cycleLines(madgeCircularReport());
    const offending = lines.filter(
      (line) => line.includes("memory-index.ts") && line.includes("index-manager.ts"),
    );
    expect(offending).toEqual([]);
  }, 90_000);
});
