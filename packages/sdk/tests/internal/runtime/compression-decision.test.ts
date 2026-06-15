/**
 * T2.2 step 4a/N — compression decision function
 * (ADR D440 — determines whether to attempt compression on error).
 *
 * Pure function that takes an error + compression state counters and
 * returns whether the agent-loop should attempt context-window
 * compression vs. propagating the error. Isolates the decision
 * logic from the loop.ts hot path so it's independently testable.
 *
 * Decision matrix (per ADR D440):
 * - Error code NOT `context_too_long` → false (not a context window error)
 * - No compression config → false (consumer didn't enable compression)
 * - Grace period not exhausted → false (count grace calls first)
 * - Attempt count >= maxAttempts → false (cap reached, propagate)
 * - Otherwise → true (attempt compression)
 */

import { describe, expect, it } from "vitest";
import {
  type CompressionState,
  shouldAttemptCompression,
} from "../../../src/internal/runtime/compression/compression-decision.js";

function makeState(overrides: Partial<CompressionState> = {}): CompressionState {
  return {
    enabled: true,
    graceRemaining: 0,
    attemptsUsed: 0,
    maxAttempts: 3,
    ...overrides,
  };
}

describe("T2.2 step 4a — shouldAttemptCompression", () => {
  it("returns true for context_too_long with enabled config + no grace + attempts left", () => {
    expect(shouldAttemptCompression("context_too_long", makeState())).toBe(true);
  });

  it("returns false for non-context_too_long error code", () => {
    expect(shouldAttemptCompression("rate_limit", makeState())).toBe(false);
  });

  it("returns false for auth_failed", () => {
    expect(shouldAttemptCompression("auth_failed", makeState())).toBe(false);
  });

  it("returns false when compression is not enabled", () => {
    expect(shouldAttemptCompression("context_too_long", makeState({ enabled: false }))).toBe(false);
  });

  it("returns false when grace period has remaining calls", () => {
    expect(shouldAttemptCompression("context_too_long", makeState({ graceRemaining: 1 }))).toBe(
      false,
    );
  });

  it("returns false when attempt cap is reached", () => {
    expect(
      shouldAttemptCompression("context_too_long", makeState({ attemptsUsed: 3, maxAttempts: 3 })),
    ).toBe(false);
  });

  it("returns true when attemptsUsed < maxAttempts", () => {
    expect(
      shouldAttemptCompression("context_too_long", makeState({ attemptsUsed: 2, maxAttempts: 3 })),
    ).toBe(true);
  });

  it("returns false for undefined error code", () => {
    expect(shouldAttemptCompression(undefined, makeState())).toBe(false);
  });
});
