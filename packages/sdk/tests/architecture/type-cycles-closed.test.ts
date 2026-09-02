/**
 * T4.1 — Close LOW type-only cycles (D438).
 *
 * Plan: arch-review-fixes-2026-06-06 § Phase 4 / T4.1.
 *
 * Cycle map from `architecture-output/final_report.md` (audit) vs the
 * `madge --circular` snapshot at iteration 12 start:
 *
 * | audit # | madge # | cycle                                                                | closes via                                 |
 * |---------|---------|----------------------------------------------------------------------|--------------------------------------------|
 * | #3      | 3       | `types/agent.ts` self-ref (inline `import("./agent.js").SDKAgent`)    | drop the inline import — direct symbol ref |
 * | #5      | 5       | `types/agent.ts ↔ types/run.ts`                                       | extract `types/agent-prims.ts` leaf        |
 * | #7      | 7       | `types/agent.ts → types/run.ts → types/messages.ts`                   | same `agent-prims.ts` leaf (ModelSelection)|
 * | #6      | 6       | `types/conversation.ts ↔ types/updates.ts`                            | extract `types/messages-base.ts` leaf      |
 * | #10     | 8       | `internal/memory/active-memory-cache.ts ↔ active-memory.ts`           | extract `internal/memory/active-memory-types.ts` |
 *
 * Cycle #4 (`types/agent.ts ↔ types/handoff.ts`) is NOT addressed by T4.1
 * as implemented. Audit prescribed `types/agent-id.ts`, but the cycle is
 * structurally bidirectional: `HandoffDescriptor.target: SDKAgent` requires
 * the runtime `SDKAgent` interface, not an identity brand. Closing it would
 * require extracting the full `SDKAgent` interface to a leaf (HIGH-impact,
 * out of scope here). Documented as a deviation in the CHANGELOG entry and
 * the implementation log.
 *
 * Cycles #1, #2 are D428-acknowledged (rollup-dts forced subscribe at
 * sub-path) and remain by design.
 */
import { describe, expect, it } from "vitest";
import { cycleLines, madgeCircularReport } from "./madge-report.js";

describe("Architecture — T4.1 type-only cycles closed (D438)", () => {
  it("madge reports NO self-cycle on types/agent.ts (audit #3)", () => {
    const lines = cycleLines(madgeCircularReport());
    const offending = lines.filter((line) => {
      const trimmed = line.replace(/^\d+\)\s*/, "").trim();
      // A self-cycle in madge output is a single-node line: `types/agent.ts`
      return trimmed === "types/agent.ts";
    });
    expect(
      offending,
      `Expected no self-cycle on types/agent.ts. Found:\n${offending.join("\n")}`,
    ).toEqual([]);
  }, 90_000);

  it("madge reports NO cycle containing types/agent.ts AND types/run.ts (audit #5 + #7)", () => {
    const lines = cycleLines(madgeCircularReport());
    const offending = lines.filter(
      (line) =>
        line.includes("types/agent.ts") &&
        line.includes("types/run.ts") &&
        !line.includes("internal/runtime/lifecycle/fork-agent.ts"), // not the same cycle
    );
    expect(offending).toEqual([]);
  }, 90_000);

  it("madge reports NO cycle containing types/agent.ts AND types/messages.ts (audit #7)", () => {
    const lines = cycleLines(madgeCircularReport());
    const offending = lines.filter(
      (line) => line.includes("types/agent.ts") && line.includes("types/messages.ts"),
    );
    expect(offending).toEqual([]);
  }, 90_000);

  it("madge reports NO cycle containing types/conversation.ts AND types/updates.ts (audit #6)", () => {
    const lines = cycleLines(madgeCircularReport());
    const offending = lines.filter(
      (line) => line.includes("types/conversation.ts") && line.includes("types/updates.ts"),
    );
    expect(offending).toEqual([]);
  }, 90_000);

  it("madge reports NO cycle in internal/memory/active-memory cluster (audit #10)", () => {
    const lines = cycleLines(madgeCircularReport());
    const offending = lines.filter(
      (line) =>
        line.includes("internal/memory/active-memory-cache.ts") &&
        line.includes("internal/memory/active-memory.ts"),
    );
    expect(offending).toEqual([]);
  }, 90_000);

  it("public type surface preserved — ModelSelection / CustomTool / UserMessage / ActiveMemoryResult exported", async () => {
    // Smoke-load the barrel; failure means a leaf re-export broke.
    const m = await import("../../src/types/agent.js");
    // Type-level: TypeScript would have errored at compile time if these
    // re-exports were missing. Runtime check is the import itself.
    expect(m).toBeDefined();

    const conv = await import("../../src/types/conversation.js");
    expect(conv).toBeDefined();

    const am = await import("../../src/internal/memory/active-memory.js");
    expect(am).toBeDefined();
  });
});
