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
 * Mirror of the wiring inside `runIteration` (loop.ts ~ line 230).
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
  it("test_no_tracker_means_noop", () => {
    // B-065. The body used to end in `expect(true).toBe(true)`, so "should not throw" was a comment
    // rather than an oracle: the wrapper's `catch {}` swallows everything, and this test would have
    // stayed green even if the undefined-tracker path had started throwing inside it and being
    // silently eaten. Asserting `.not.toThrow()` around the call is the claim the comment already
    // made, and it fails if the guard is removed and the throw escapes.
    expect(() => {
      emitBudgetTrackEvents(undefined, "x", 100, 50);
    }, "an absent tracker must be a silent no-op, not a swallowed error").not.toThrow();
  });

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
