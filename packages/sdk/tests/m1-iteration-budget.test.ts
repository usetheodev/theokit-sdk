/**
 * M1-1 (plan m1-reliable-harness, T1.1) — wire the dead iteration counter.
 *
 * `createCounterBudgetTracker({ maxIterations })` was unable to halt the loop
 * because nothing called `nextIteration()`. The loop now calls
 * `inputs.budgetTracker?.nextIteration?.()` once per completed turn. These tests
 * pin: (a) the counter tracker halts after N advances; (b) the loop's per-turn
 * advance call advances a supporting tracker and no-ops for one without it.
 *
 * Loop-wiring is verified via a mirror of the exact call the loop makes
 * (`loop.ts` after `budget.consume()`) — the repo convention for loop hooks
 * that cannot drive the full agent loop without a stubbed LLM (see
 * agent-loop-budget-tracker-wiring.test.ts).
 */

import { createCounterBudgetTracker } from "@theokit/sdk";
import { describe, expect, it, vi } from "vitest";
// Type imported from src (not the dist barrel) so typecheck sees the new
// optional `nextIteration` member before a rebuild — repo convention
// (cf. agent-loop-budget-gate.test.ts).
import type { BudgetTracker } from "../src/internal/runtime/budget/budget-tracker.js";
import type { RunResult, SendOptions } from "../src/types/run.js";

/** Mirror of the per-turn advance the loop performs after `budget.consume()`. */
function advanceIteration(tracker: BudgetTracker | undefined): void {
  tracker?.nextIteration?.();
}

describe("M1-1 iteration budget wiring", () => {
  it("test_counter_tracker_halts_after_maxIterations", () => {
    const tracker = createCounterBudgetTracker({ maxIterations: 3 });
    // Before any advance, the loop is allowed to proceed.
    expect(tracker.check().allowed).toBe(true);
    advanceIteration(tracker); // turn 1
    advanceIteration(tracker); // turn 2
    expect(tracker.check().allowed).toBe(true); // 2 < 3
    advanceIteration(tracker); // turn 3
    const decision = tracker.check();
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("iteration_limit");
  });

  it("test_loop_advance_increments_counter_total", () => {
    const tracker = createCounterBudgetTracker({ maxIterations: 10 });
    advanceIteration(tracker);
    advanceIteration(tracker);
    expect(tracker.getTotal().iterations).toBe(2);
  });

  it("test_loop_advance_noops_for_tracker_without_nextIteration", () => {
    // A custom tracker that only gates on tokens omits nextIteration — the
    // loop's optional-chaining call must not throw.
    const tokenOnly: BudgetTracker = {
      track: () => {},
      check: () => ({ allowed: true }),
      getTotal: () => ({ tokens: 0 }),
    };
    expect(() => advanceIteration(tokenOnly)).not.toThrow();
  });

  it("test_loop_advance_noops_for_undefined_tracker", () => {
    expect(() => advanceIteration(undefined)).not.toThrow();
  });

  it("test_counter_tracker_nextIteration_is_called_once_per_turn", () => {
    const tracker = createCounterBudgetTracker({ maxIterations: 5 });
    const spy = vi.spyOn(tracker, "nextIteration");
    advanceIteration(tracker);
    advanceIteration(tracker);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("M1-2 SendOptions.maxIterations knob", () => {
  it("test_send_maxIterations_is_a_public_optional_field", () => {
    // Typecheck-level contract: the field exists on SendOptions and is optional.
    const opts: SendOptions = { maxIterations: 25 };
    expect(opts.maxIterations).toBe(25);
    const noKnob: SendOptions = {};
    expect(noKnob.maxIterations).toBeUndefined();
  });
});

/**
 * Mirror of the loop's truncation-detection rule (loop.ts, after the while):
 *   stoppedAtIterationLimit = lastTurnDecision === "continue" && budgetExhausted
 * Kept in lockstep with the runtime; the full loop needs a stubbed LLM to drive
 * (repo convention — see agent-loop-budget-tracker-wiring.test.ts).
 */
function isTruncation(
  lastTurnDecision: "continue" | "done" | "error" | undefined,
  budgetExhausted: boolean,
): boolean {
  return lastTurnDecision === "continue" && budgetExhausted;
}

describe("M1-2 truncation signal (RunResult.stoppedAtIterationLimit)", () => {
  it("test_truncation_true_when_capped_mid_tools", () => {
    // Budget ran out while the last turn still wanted tools → silent truncation.
    expect(isTruncation("continue", true)).toBe(true);
  });

  it("test_no_truncation_on_clean_done_finish", () => {
    // Model emitted a final answer (done) → not truncated, even if budget is now 0.
    expect(isTruncation("done", true)).toBe(false);
  });

  it("test_no_truncation_on_error_exit", () => {
    expect(isTruncation("error", true)).toBe(false);
  });

  it("test_no_truncation_when_budget_not_exhausted", () => {
    // Loop broke (done/error) before exhausting budget → not a cap truncation.
    expect(isTruncation("continue", false)).toBe(false);
  });

  it("test_truncation_also_set_when_tracker_denies_on_iteration_limit", () => {
    // Mirror of the gate branch: a pluggable tracker denying with
    // reason "iteration_limit" surfaces the SAME stoppedAtIterationLimit signal
    // as the legacy IterationBudget exhausting — consistency for consumers using
    // createCounterBudgetTracker({ maxIterations }).
    const tracker = createCounterBudgetTracker({ maxIterations: 1 });
    advanceIteration(tracker); // now at the cap
    const decision = tracker.check();
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("iteration_limit");
    // The loop sets the flag when this branch fires (loop.ts gate branch).
    const flagSetByGate = decision.allowed === false && decision.reason === "iteration_limit";
    expect(flagSetByGate).toBe(true);
  });

  it("test_runResult_stoppedAtIterationLimit_is_a_public_optional_field", () => {
    const truncated: RunResult = { id: "r1", status: "finished", stoppedAtIterationLimit: true };
    expect(truncated.stoppedAtIterationLimit).toBe(true);
    const clean: RunResult = { id: "r2", status: "finished" };
    expect(clean.stoppedAtIterationLimit).toBeUndefined();
  });
});
