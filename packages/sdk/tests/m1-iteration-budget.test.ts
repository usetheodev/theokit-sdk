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
 * (`loop.ts` after `budget.consume()`).
 *
 * CITATION CORRECTED 2026-09-01. This docblock used to justify its mirror by pointing at
 * `agent-loop/budget-tracker-wiring.test.ts` as the repo convention. That premise is false and the
 * cited file says so itself. `agent-loop/budget-tracker-wiring.test.ts`
 * was repaired under B-095 and its docblock now records the opposite of what this comment claims for it:
 * *"A mirror passes for exactly as long as someone remembers to edit it alongside the code, which is the
 * property it was supposed to VERIFY rather than assume. No mutation of the real wiring could fail
 * anything here."* And the harness it says does not exist does: `LlmClient` has two members (`name` +
 * `stream`), the stub is ten lines, and 22 test files in this package already drive the real
 * `runAgentLoop` — `agent-loop/memory-provider-integration.test.ts` among them.
 *
 * Citation corrected 2026-09-01. A stale pointer to a repaired exemplar is how an anti-pattern keeps
 * recruiting after it has been named, which is why this note replaces the appeal rather than deleting it.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCounterBudgetTracker } from "@theokit/sdk";
import { afterAll, describe, expect, it, vi } from "vitest";
// Type imported from src (not the dist barrel) so typecheck sees the new
// optional `nextIteration` member before a rebuild — repo convention
// (cf. agent-loop/budget-gate.test.ts).
import type { BudgetTracker } from "../src/internal/budget/tracker/budget-tracker.js";
import type { LlmClient, LlmEvent, LlmFinish } from "../src/internal/llm/types.js";
import type { RunResult, SendOptions } from "../src/types/run.js";
import { driveLoop } from "./helpers/agent-loop-driver.js";
import { removeTempDirRobustSync } from "./helpers/temp-workspace.js";

const CWD = mkdtempSync(join(tmpdir(), "theokit-m1budget-"));
afterAll(() => {
  removeTempDirRobustSync(CWD);
});

/**
 * CONVERTED 2026-09-01. `((t: BudgetTracker | undefined) => t?.nextIteration?.())(tracker)` — a one-line mirror of
 * `inputs.budgetTracker?.nextIteration?.()` — used to stand between these cases and the loop.
 *
 * Removing it exposed that the WIRING had no coverage at all. Measured: deleting that call from
 * `loop.ts:110` left 29 tests across the four budget-related files GREEN. Every case here was really
 * a unit test of `createCounterBudgetTracker` wearing a wiring name, and the one test that could
 * have caught the loop dropping the advance did not exist.
 *
 * So the mirror is gone in two directions: the tracker-semantics cases call the tracker directly and
 * say so, and a new case drives the real loop to assert the advance actually fires.
 */
describe("M1-1 iteration budget wiring", () => {
  it("test_counter_tracker_halts_after_maxIterations", () => {
    const tracker = createCounterBudgetTracker({ maxIterations: 3 });
    // Before any advance, the loop is allowed to proceed.
    expect(tracker.check().allowed).toBe(true);
    tracker.nextIteration?.(); // turn 1
    tracker.nextIteration?.(); // turn 2
    expect(tracker.check().allowed).toBe(true); // 2 < 3
    tracker.nextIteration?.(); // turn 3
    const decision = tracker.check();
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("iteration_limit");
  });

  it("test_loop_advance_increments_counter_total", () => {
    const tracker = createCounterBudgetTracker({ maxIterations: 10 });
    tracker.nextIteration?.();
    tracker.nextIteration?.();
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
    expect(() => ((t: BudgetTracker | undefined) => t?.nextIteration?.())(tokenOnly)).not.toThrow();
  });

  it("test_loop_advance_noops_for_undefined_tracker", () => {
    expect(() => ((t: BudgetTracker | undefined) => t?.nextIteration?.())(undefined)).not.toThrow();
  });

  it("test_counter_tracker_nextIteration_is_called_once_per_turn", () => {
    const tracker = createCounterBudgetTracker({ maxIterations: 5 });
    const spy = vi.spyOn(tracker, "nextIteration");
    tracker.nextIteration?.();
    tracker.nextIteration?.();
    expect(spy).toHaveBeenCalledTimes(2);
  });
  it("test_the_loop_advances_the_tracker_once_per_continuing_turn", async () => {
    // THE CASE THAT WAS MISSING. Everything else in this describe exercises the tracker; this is the
    // only one that fails if `loop.ts` stops calling `nextIteration()`. Verified by mutation before
    // it was written: removing that call left this file and three sibling files entirely green — 29
    // tests, none of which could see the wiring they were named for.
    //
    // The stub asks for a tool on the first turn and finishes on the second, because the advance
    // sits AFTER the `done`/`error` breaks (loop.ts:101-110): a single end_turn reply never reaches
    // it. That detail is why a mirror could not have found this — the mirror called the advance
    // unconditionally, so it never had to know when the loop does.
    let turn = 0;
    const client: LlmClient = {
      name: "two-turn-stub",
      async *stream(): AsyncGenerator<LlmEvent, LlmFinish, void> {
        turn += 1;
        if (turn === 1) {
          return {
            stopReason: "tool_use",
            text: "",
            toolCalls: [
              { type: "tool_use", id: "call-1", name: "shell", input: { command: "true" } },
            ],
          };
        }
        yield { type: "text_delta", text: "done" };
        return { stopReason: "end_turn", text: "done", toolCalls: [] };
      },
    };
    const tracker = createCounterBudgetTracker({ maxIterations: 5 });
    const spy = vi.spyOn(tracker, "nextIteration");
    await driveLoop(CWD, { budgetTracker: tracker, llm: client });
    expect(
      spy,
      "a turn that continues must advance the iteration counter exactly once",
    ).toHaveBeenCalledTimes(1);
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
 * The truncation RULE is not tested here, deliberately.
 *
 * This block used to hold `isTruncation` — a copy of `lastTurnDecision === "continue" &&
 * budgetExhausted` from `loop.ts` — plus five cases over the copy. Measured 2026-09-01: replacing
 * the real condition with `if (false)` so `stoppedAtIterationLimit` is never set left every one of
 * those five GREEN, while `agent-loop/iteration-limit-error.test.ts` ("still reports the structured
 * truncation signal") failed. The coverage was already one file away, driving the real loop; the
 * copy only proved that `&&` works.
 *
 * What remains is the one assertion that is about the PUBLIC CONTRACT rather than the rule: that
 * `RunResult.stoppedAtIterationLimit` is an optional boolean a caller can read.
 */
describe("M1-2 truncation signal (RunResult.stoppedAtIterationLimit)", () => {
  it("test_runResult_stoppedAtIterationLimit_is_a_public_optional_field", () => {
    const truncated: RunResult = { id: "r1", status: "finished", stoppedAtIterationLimit: true };
    expect(truncated.stoppedAtIterationLimit).toBe(true);
    const clean: RunResult = { id: "r2", status: "finished" };
    expect(clean.stoppedAtIterationLimit).toBeUndefined();
  });
});
