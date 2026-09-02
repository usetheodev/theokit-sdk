/**
 * The pre-iteration budget gate, driven through the production symbol.
 *
 * WHAT THIS FILE USED TO BE, and why that mattered more than the duplication. It defined a ten-line
 * local copy of the loop's wiring — `shouldAbortPerTracker` — and every one of its six tests
 * asserted against the copy. No production symbol was called. The copy was not merely stale, it was
 * INVERTED on the one branch that is a safety decision:
 *
 *     try { decision = tracker.check(); } catch { decision = { allowed: true }; }
 *
 * and a test named `test_check_throw_is_soft_allow` pinned that as the contract. `budget-gate.ts`
 * names that exact line as a defect it already fixed: *"A budget gate is a cost/safety control, so
 * if a tracker violates that contract by throwing, the loop MUST fail CLOSED … the previous inline
 * `catch { decision = { allowed: true } }` let a broken tracker run forever."*
 *
 * So the suite contained two tests stating opposite contracts for the same event —
 * `agent-loop/budget-gate.test.ts:48` asserts fail-closed — and it was green, because only one of
 * them was connected to the code. A regression test that would keep passing if the fix it covers
 * were reverted is worse than no test: its name is what stops anyone looking.
 *
 * Everything below now calls `evaluateBudgetGate`, which is what `loop.ts:78-81` calls.
 */
import { createCounterBudgetTracker } from "@theokit/sdk";
import { describe, expect, it, vi } from "vitest";
import { evaluateBudgetGate } from "../../src/internal/agent-loop/budget-gate.js";
import type { BudgetTracker } from "../../src/types/budget-tracker.js";

/** What the loop does with a decision: `allowed === false` breaks the iteration. */
function outcome(tracker: BudgetTracker | undefined): "proceed" | "abort" {
  return evaluateBudgetGate(tracker).allowed === false ? "abort" : "proceed";
}

describe("the pre-iteration budget gate (loop.ts:78 → evaluateBudgetGate)", () => {
  it("test_no_tracker_proceeds", () => {
    expect(outcome(undefined)).toBe("proceed");
  });

  it("test_allowed_tracker_proceeds", () => {
    expect(outcome(createCounterBudgetTracker())).toBe("proceed");
  });

  it("test_blocked_tracker_aborts", () => {
    const tracker = createCounterBudgetTracker({ maxTokens: 10 });
    tracker.track({ tokens: 50, model: "x", type: "input" });
    expect(tracker.check().allowed).toBe(false);
    expect(outcome(tracker)).toBe("abort");
  });

  it("test_check_throw_fails_closed", () => {
    // RENAMED AND INVERTED. This was `test_check_throw_is_soft_allow`, asserting "proceed" against
    // the local mirror's fail-open catch. A tracker that cannot evaluate the budget has not said
    // the budget is fine — it has said nothing, and a cost control that proceeds on silence is not
    // a control. The detail carries the underlying message so an operator can see WHICH tracker
    // broke rather than only that the loop stopped.
    const throwing: BudgetTracker = {
      track: () => undefined,
      check: () => {
        throw new Error("simulated tracker fault");
      },
      getTotal: () => ({ tokens: 0 }),
    };
    const decision = evaluateBudgetGate(throwing);
    expect(outcome(throwing)).toBe("abort");
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("custom");
    expect(decision.detail).toContain("simulated tracker fault");
  });

  it("test_check_is_called_each_iteration_not_cached", () => {
    const tracker = createCounterBudgetTracker({ maxTokens: 100 });
    const spy = vi.spyOn(tracker, "check");
    expect(outcome(tracker)).toBe("proceed");
    tracker.track({ tokens: 50, model: "x", type: "input" });
    expect(outcome(tracker)).toBe("proceed");
    tracker.track({ tokens: 50, model: "x", type: "input" });
    expect(outcome(tracker)).toBe("abort");
    expect(
      spy,
      "the gate must re-evaluate per iteration, never cache a decision",
    ).toHaveBeenCalledTimes(3);
  });

  it("test_aborted_decision_carries_reason", () => {
    const tracker = createCounterBudgetTracker({ maxIterations: 1 });
    tracker.nextIteration();
    const decision = evaluateBudgetGate(tracker);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("iteration_limit");
  });
});
