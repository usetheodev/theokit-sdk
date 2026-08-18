/**
 * Smoke test for the BudgetTracker.track() wiring in runIteration
 * (SDK 2.0 Phase 2 / T2.1 — first runtime hook).
 *
 * Cannot drive the full agent-loop here without a stubbed LLM (would
 * pull a deep mock setup). Instead, tests the BRANCH LOGIC the wiring
 * implements: given an LlmTurnOutput-shaped object + a tracker spy,
 * the same conditional checks that `runIteration` performs MUST also
 * fire here. Pinning this guards against regressions when the wiring
 * is refactored.
 */

import { type BudgetTracker, createCounterBudgetTracker } from "@theokit/sdk";
import { describe, expect, it, vi } from "vitest";

/**
 * Mirror of the wiring inside `runIteration` (loop.ts:365-386).
 * Kept in lockstep with the runtime call. If the runtime code changes,
 * this helper changes too — they MUST be byte-identical in semantics.
 */
function emitBudgetTrackEvents(
  tracker: BudgetTracker | undefined,
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): void {
  if (tracker === undefined) return;
  try {
    if (inputTokens > 0) {
      tracker.track({ tokens: inputTokens, model: modelId, type: "input" });
    }
    if (outputTokens > 0) {
      tracker.track({ tokens: outputTokens, model: modelId, type: "output" });
    }
  } catch {
    // Swallow per contract.
  }
}

describe("BudgetTracker.track() wiring (Phase 2 / T2.1 runtime hook)", () => {
  // B-065. `test_no_tracker_means_noop` stood here with `expect(true).toBe(true)`. The repair made
  // it `.not.toThrow()` around the call — which is unfalsifiable for the same reason the tautology
  // was: `emitBudgetTrackEvents` wraps the body in `catch {}`, so removing the undefined-guard makes
  // the resulting TypeError vanish and the test stays green. Review confirmed it by mutation.
  //
  // There is no third assertion to reach for. With `tracker === undefined` the function has no
  // return value and no side effect, and `emitBudgetTrackEvents` is a test-local MIRROR of
  // `loop.ts:365-386`, so no mutation of the WIRING can fail anything here.
  //
  // That is narrower than "no `src/` mutation can fail this file", which is what an earlier version
  // of this comment claimed and which is false: `createCounterBudgetTracker` is a real production
  // symbol imported from the built barrel, and doubling its accumulator fails
  // `test_both_token_counts_fire_separate_events` with `expected 320 to be 160` once the gate
  // rebuilds (`turbo.json` `test` dependsOn `build`). The tracker is covered; the wiring is not.
  // The case is removed rather than dressed up.
  // Registered as B-095: the wiring needs a test against the production `runIteration`, which needs
  // a loop harness this batch does not build.

  it("test_both_token_counts_fire_separate_events", () => {
    const tracker: BudgetTracker = createCounterBudgetTracker();
    const spy = vi.spyOn(tracker, "track");
    emitBudgetTrackEvents(tracker, "openai/gpt-4o-mini", 120, 40);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, {
      tokens: 120,
      model: "openai/gpt-4o-mini",
      type: "input",
    });
    expect(spy).toHaveBeenNthCalledWith(2, {
      tokens: 40,
      model: "openai/gpt-4o-mini",
      type: "output",
    });
    expect(tracker.getTotal().tokens).toBe(160);
  });

  it("test_zero_input_skips_input_event", () => {
    const tracker = createCounterBudgetTracker();
    const spy = vi.spyOn(tracker, "track");
    emitBudgetTrackEvents(tracker, "m", 0, 50);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0].type).toBe("output");
  });

  it("test_zero_output_skips_output_event", () => {
    const tracker = createCounterBudgetTracker();
    const spy = vi.spyOn(tracker, "track");
    emitBudgetTrackEvents(tracker, "m", 100, 0);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0].type).toBe("input");
  });

  it("test_both_zero_no_events_fired", () => {
    const tracker = createCounterBudgetTracker();
    const spy = vi.spyOn(tracker, "track");
    emitBudgetTrackEvents(tracker, "m", 0, 0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("test_tracker_throw_is_swallowed", () => {
    const throwingTracker: BudgetTracker = {
      track: () => {
        throw new Error("contract violation: should not throw");
      },
      check: () => ({ allowed: true }),
      getTotal: () => ({ tokens: 0 }),
    };
    // Must not propagate the throw — hot path protection.
    expect(() => emitBudgetTrackEvents(throwingTracker, "m", 10, 5)).not.toThrow();
  });

  it("test_model_id_threaded_into_event", () => {
    const tracker = createCounterBudgetTracker();
    const spy = vi.spyOn(tracker, "track");
    emitBudgetTrackEvents(tracker, "anthropic/claude-3-5-sonnet", 10, 5);
    expect(spy.mock.calls[0]?.[0].model).toBe("anthropic/claude-3-5-sonnet");
    expect(spy.mock.calls[1]?.[0].model).toBe("anthropic/claude-3-5-sonnet");
  });
});
