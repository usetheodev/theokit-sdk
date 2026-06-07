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
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function runMadge(): string {
  const repoRoot = resolve(__dirname, "../../../../..");
  const target = "packages/sdk/src";
  const result = spawnSync(
    "pnpm",
    ["exec", "madge", "--circular", "--extensions", "ts,tsx", target],
    { cwd: repoRoot, encoding: "utf8", timeout: 60_000 },
  );
  return (result.stdout ?? "") + (result.stderr ?? "");
}

describe("Architecture — Cycle #9 closure (T1.1 / D432, CRITICAL)", () => {
  it("madge reports NO cycle containing agent-session.ts AND conversation-storage-fs.ts", () => {
    const output = runMadge();
    const cycleLines = output.split("\n").filter((line) => /^\d+\)/.test(line.trim()));
    const offending = cycleLines.filter(
      (line) => line.includes("agent-session.ts") && line.includes("conversation-storage-fs.ts"),
    );
    expect(
      offending,
      `Expected no cycle containing both runtime/agent-session.ts AND persistence/conversation-storage-fs.ts (the layer-crossing CRITICAL cycle #9). Found:\n${offending.join("\n")}`,
    ).toEqual([]);
  }, 90_000);

  it("madge reports NO cycle containing agent-session.ts AND agent-session-store.ts (back-edge eliminated)", () => {
    const output = runMadge();
    const cycleLines = output.split("\n").filter((line) => /^\d+\)/.test(line.trim()));
    const offending = cycleLines.filter(
      (line) => line.includes("agent-session.ts") && line.includes("agent-session-store.ts"),
    );
    expect(offending).toEqual([]);
  }, 90_000);
});
