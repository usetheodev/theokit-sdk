/**
 * T3.8 — Anthropic native cache-token surfacing on `LlmFinish`.
 *
 * Pre-T3.8 the Anthropic accumulator at `internal/llm/anthropic.ts:167-170`
 * read only `input_tokens` and `output_tokens` from the `message_delta`
 * usage object — silently dropped `cache_creation_input_tokens` and
 * `cache_read_input_tokens` even though Anthropic emits them when the
 * `cache_control: {type: "ephemeral"}` annotation (shipped in T3.5) is
 * present on system blocks. As a result the budget accumulator's 5-bucket
 * telemetry (`cacheReadTokens` / `cacheWriteTokens`) stayed at zero and
 * cost calculations couldn't apply the 1-3x cache-read discount.
 *
 * T3.8 widens the AnthropicMessageDelta type, threads the two extra
 * counters through `handleMessageDelta`, and emits them on `LlmFinish`.
 * The UsageAccumulator at `internal/budget/usage-accumulator.ts:34-46`
 * already supports the fields — this iter only wires the Anthropic side.
 */

import { describe, expect, it } from "vitest";

import { __testing__AnthropicAccumulator } from "../../../src/internal/llm/anthropic.js";

describe("T3.8 — Anthropic cache-token surfacing on LlmFinish", () => {
  it("cache_creation_input_tokens flows to LlmFinish.cacheWriteTokens", () => {
    const acc = new __testing__AnthropicAccumulator();
    acc.handleMessageDelta({
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: {
        input_tokens: 12,
        output_tokens: 8,
        cache_creation_input_tokens: 1024,
        cache_read_input_tokens: 0,
      },
    });
    const finish = acc.finish();
    expect(finish.inputTokens).toBe(12);
    expect(finish.outputTokens).toBe(8);
    expect(finish.cacheWriteTokens).toBe(1024);
    expect(finish.cacheReadTokens).toBeUndefined();
  });

  it("cache_read_input_tokens flows to LlmFinish.cacheReadTokens", () => {
    const acc = new __testing__AnthropicAccumulator();
    acc.handleMessageDelta({
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: {
        input_tokens: 4,
        output_tokens: 16,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 2048,
      },
    });
    const finish = acc.finish();
    expect(finish.cacheReadTokens).toBe(2048);
    expect(finish.cacheWriteTokens).toBeUndefined();
  });

  it("missing cache fields leave the LlmFinish counters undefined (no zeros)", () => {
    const acc = new __testing__AnthropicAccumulator();
    acc.handleMessageDelta({
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { input_tokens: 10, output_tokens: 20 },
    });
    const finish = acc.finish();
    expect(finish.cacheReadTokens).toBeUndefined();
    expect(finish.cacheWriteTokens).toBeUndefined();
  });

  it("both cache fields populated — 5-bucket roundtrip preserved", () => {
    const acc = new __testing__AnthropicAccumulator();
    acc.handleMessageDelta({
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: {
        input_tokens: 50,
        output_tokens: 100,
        cache_creation_input_tokens: 256,
        cache_read_input_tokens: 1500,
      },
    });
    const finish = acc.finish();
    expect(finish).toMatchObject({
      inputTokens: 50,
      outputTokens: 100,
      cacheWriteTokens: 256,
      cacheReadTokens: 1500,
    });
  });
});
