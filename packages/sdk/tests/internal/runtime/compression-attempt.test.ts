/**
 * T2.2 step 4b — attemptCompressionIfNeeded integration
 * (ADR D440 — the final wire that connects compression modules).
 *
 * Tests the integration function that orchestrates:
 *   1. shouldAttemptCompression (decision)
 *   2. selectCompressionWindow (existing helpers)
 *   3. compressConversationWindow (summarizer)
 *   4. message replacement in the conversation
 *
 * Uses DI seam (callLlm) so no real LLM cost.
 */

import { describe, expect, it } from "vitest";
import { attemptCompressionIfNeeded } from "../../../src/internal/runtime/compression-attempt.js";
import type { CompressionState } from "../../../src/internal/runtime/compression-decision.js";
import type { CompressibleMessage } from "../../../src/internal/runtime/compression-summarizer.js";

function makeMessages(n: number): CompressibleMessage[] {
  const msgs: CompressibleMessage[] = [];
  for (let i = 0; i < n; i++) {
    msgs.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Message ${i}: ${"content ".repeat(20)}`,
    });
  }
  return msgs;
}

describe("T2.2 step 4b — attemptCompressionIfNeeded", () => {
  it("returns compressed messages when decision is YES and LLM succeeds", async () => {
    const messages = makeMessages(10);
    const state: CompressionState = {
      enabled: true,
      graceRemaining: 0,
      attemptsUsed: 0,
      maxAttempts: 3,
    };

    const result = await attemptCompressionIfNeeded({
      errorCode: "context_too_long",
      messages,
      state,
      model: "openai/gpt-4o-mini",
      callLlm: async () => "Summary of the first 4 messages.",
      preserveLast: 6,
    });

    expect(result.compressed).toBe(true);
    if (result.compressed) {
      // Summary message (system) + preserved messages (last 6)
      expect(result.messages.length).toBeLessThanOrEqual(7);
      expect(result.messages[0].role).toBe("system");
      expect(result.messages[0].content).toContain("Summary");
      expect(state.attemptsUsed).toBe(1);
    }
  });

  it("returns NOT compressed when error is not context_too_long", async () => {
    const messages = makeMessages(10);
    const state: CompressionState = {
      enabled: true,
      graceRemaining: 0,
      attemptsUsed: 0,
      maxAttempts: 3,
    };

    const result = await attemptCompressionIfNeeded({
      errorCode: "rate_limit",
      messages,
      state,
      model: "openai/gpt-4o-mini",
      callLlm: async () => "Should not be called",
    });

    expect(result.compressed).toBe(false);
  });

  it("returns NOT compressed when cap is reached", async () => {
    const messages = makeMessages(10);
    const state: CompressionState = {
      enabled: true,
      graceRemaining: 0,
      attemptsUsed: 3,
      maxAttempts: 3,
    };

    const result = await attemptCompressionIfNeeded({
      errorCode: "context_too_long",
      messages,
      state,
      model: "openai/gpt-4o-mini",
      callLlm: async () => "Should not be called",
    });

    expect(result.compressed).toBe(false);
  });

  it("returns NOT compressed when LLM fails (catches + returns false)", async () => {
    const messages = makeMessages(10);
    const state: CompressionState = {
      enabled: true,
      graceRemaining: 0,
      attemptsUsed: 0,
      maxAttempts: 3,
    };

    const result = await attemptCompressionIfNeeded({
      errorCode: "context_too_long",
      messages,
      state,
      model: "openai/gpt-4o-mini",
      callLlm: async () => {
        throw new Error("LLM 401");
      },
    });

    // LLM failure → not compressed, counter incremented
    expect(result.compressed).toBe(false);
    expect(state.attemptsUsed).toBe(1);
  });
});
