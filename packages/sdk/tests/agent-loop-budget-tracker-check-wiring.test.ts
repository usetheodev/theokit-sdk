/**
 * Smoke test for the BudgetTracker.check() wiring in runAgentLoop's
 * outer while-loop (SDK 2.0 Phase 2 / T2.1 — second runtime hook).
 *
 * Pins the conditional behavior the runtime implements:
 *   - No tracker → no check call.
 *   - tracker.check() returns { allowed: true } → proceed.
 *   - tracker.check() returns { allowed: false } → abort with error.
 *   - tracker.check() throws → treated as soft-allow (don't block on
 *     tracker errors).
 *
 * Mirrors the runtime logic in `loop.ts ~ lines 51-70` for regression
 * coverage WITHOUT requiring a fully stubbed agent loop driver.
 */

import { type BudgetTracker, createCounterBudgetTracker } from "@theokit/sdk";
import { describe, expect, it, vi } from "vitest";

/**
 * Mirror of the wiring inside the runAgentLoop while-loop (loop.ts).
 * Returns "proceed" if the iteration may run, "abort" if the loop
 * should break with finalStatus = error.
 */
function shouldAbortPerTracker(tracker: BudgetTracker | undefined): "proceed" | "abort" {
  if (tracker === undefined) return "proceed";
  let decision: ReturnType<typeof tracker.check>;
  try {
    decision = tracker.check();
  } catch {
    decision = { allowed: true };
  }
  return decision.allowed === false ? "abort" : "proceed";
}

describe("BudgetTracker.check() wiring (Phase 2 / T2.1 runtime hook #2)", () => {
  it("test_no_tracker_proceeds", () => {
    expect(shouldAbortPerTracker(undefined)).toBe("proceed");
  });

  it("test_allowed_tracker_proceeds", () => {
    const tracker = createCounterBudgetTracker();
    expect(shouldAbortPerTracker(tracker)).toBe("proceed");
  });

  it("test_blocked_tracker_aborts", () => {
    const tracker = createCounterBudgetTracker({ maxTokens: 10 });
    tracker.track({ tokens: 50, model: "x", type: "input" });
    expect(tracker.check().allowed).toBe(false);
    expect(shouldAbortPerTracker(tracker)).toBe("abort");
  });

  it("test_check_throw_is_soft_allow", () => {
    const throwing: BudgetTracker = {
      track: () => undefined,
      check: () => {
        throw new Error("simulated tracker fault");
      },
      getTotal: () => ({ tokens: 0 }),
    };
    // Must NOT propagate; loop continues.
    expect(shouldAbortPerTracker(throwing)).toBe("proceed");
  });

  it("test_check_is_called_each_iteration_not_cached", () => {
    const tracker = createCounterBudgetTracker({ maxTokens: 100 });
    const spy = vi.spyOn(tracker, "check");
    // Iteration 1: proceed.
    expect(shouldAbortPerTracker(tracker)).toBe("proceed");
    // Iteration 2: still proceed (50 < 100).
    tracker.track({ tokens: 50, model: "x", type: "input" });
    expect(shouldAbortPerTracker(tracker)).toBe("proceed");
    // Iteration 3: abort (100 >= 100).
    tracker.track({ tokens: 50, model: "x", type: "input" });
    expect(shouldAbortPerTracker(tracker)).toBe("abort");
    // check() called 3 times (3 iterations), not cached.
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("test_aborted_decision_carries_reason", () => {
    const tracker = createCounterBudgetTracker({ maxIterations: 1 });
    tracker.nextIteration();
    const decision = tracker.check();
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("iteration_limit");
  });
});
