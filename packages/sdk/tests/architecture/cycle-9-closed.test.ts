/**
 * T1.1 — Cycle #9 (CRITICAL) closure verification.
 *
 * Plan: arch-review-fixes-2026-06-06 § Phase 1 / T1.1 (ADR D432,
 * implementation deviation documented: type-leaf extraction adopted
 * over port-and-adapter refactor because the cycle's back-edge was a
 * types-only import — the smallest break that actually closes the cycle).
 *
 * Verifies via `madge --circular` that the 3-node layer-crossing cycle
 * `runtime/agent-session.ts → persistence/conversation-storage-fs.ts →
 * runtime/agent-session-store.ts → runtime/agent-session.ts` is closed
 * after the `session-types.ts` leaf-types extraction.
 *
 * This was the audit's only CRITICAL cycle — it crossed the runtime ↔
 * persistence layer boundary, violating `rules/architecture.md § 1`.
 */
import { describe, expect, it } from "vitest";
import { cycleLines, madgeCircularReport } from "./madge-report.js";

describe("Architecture — Cycle #9 closure (T1.1 / D432, CRITICAL)", () => {
  it("madge reports NO cycle containing agent-session.ts AND conversation-storage-fs.ts", () => {
    const lines = cycleLines(madgeCircularReport());
    const offending = lines.filter(
      (line) => line.includes("agent-session.ts") && line.includes("conversation-storage-fs.ts"),
    );
    expect(
      offending,
      `Expected no cycle containing both runtime/agent-session.ts AND persistence/conversation-storage-fs.ts (the layer-crossing CRITICAL cycle #9). Found:\n${offending.join("\n")}`,
    ).toEqual([]);
  }, 90_000);

  it("madge reports NO cycle containing agent-session.ts AND agent-session-store.ts (back-edge eliminated)", () => {
    const lines = cycleLines(madgeCircularReport());
    const offending = lines.filter(
      (line) => line.includes("agent-session.ts") && line.includes("agent-session-store.ts"),
    );
    expect(offending).toEqual([]);
  }, 90_000);
});
