/**
 * theokit#122 — the thinking block's cryptographic signature must survive the round trip.
 *
 * Anthropic verifies the signature against the thinking text on the NEXT request. Replay the text
 * without it and the turn is rejected with `400 "thinking blocks cannot be modified"`
 * (anthropics/claude-code#63147) — which is why an extended-thinking session could be persisted and
 * never resumed.
 *
 * The chain has four links and each one dropped it before this: the adapter never requested
 * thinking, never parsed the block, the loop never persisted one, and the transcript reader threw
 * thinking blocks away. Tests here cover the two provider-facing links; the persistence round trip
 * lives in `tests/internal/session/thinking-signature-roundtrip.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { __testing__AnthropicAccumulator } from "../../../src/internal/llm/anthropic.js";
import {
  buildAnthropicCommonBody,
  toAnthropicWireMessage,
} from "../../../src/internal/llm/anthropic-shared.js";
import type { LlmEvent } from "../../../src/internal/llm/types.js";

/** Drive the accumulator with the exact event sequence Anthropic streams for a thinking turn. */
function streamAThinkingTurn(): {
  events: LlmEvent[];
  finish: ReturnType<InstanceType<typeof __testing__AnthropicAccumulator>["finish"]>;
} {
  const acc = new __testing__AnthropicAccumulator();
  const events: LlmEvent[] = [];
  const feed = (e: unknown): void => {
    events.push(...acc.consume(e as never));
  };

  feed({
    type: "content_block_start",
    index: 0,
    content_block: { type: "thinking", thinking: "" },
  });
  feed({
    type: "content_block_delta",
    index: 0,
    delta: { type: "thinking_delta", thinking: "Let me " },
  });
  feed({
    type: "content_block_delta",
    index: 0,
    delta: { type: "thinking_delta", thinking: "count." },
  });
  feed({
    type: "content_block_delta",
    index: 0,
    delta: { type: "signature_delta", signature: "ErUBCkYIBB" },
  });
  feed({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } });
  feed({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Four." } });
  feed({ type: "message_delta", delta: { stop_reason: "end_turn" } });

  return { events, finish: acc.finish() };
}

describe("theokit#122 — Anthropic extended-thinking signature", () => {
  it("test_the_signature_reaches_the_finish_value_with_its_thinking_text", () => {
    const { finish } = streamAThinkingTurn();

    expect(finish.thinking).toEqual({
      type: "thinking",
      text: "Let me count.",
      signature: "ErUBCkYIBB",
    });
    // The answer text must not absorb the thinking — they are separate blocks.
    expect(finish.text).toBe("Four.");
  });

  it("test_thinking_streams_as_reasoning_delta_so_the_loop_needs_no_provider_branch", () => {
    const { events } = streamAThinkingTurn();

    const reasoning = events.filter((e) => e.type === "reasoning_delta");
    expect(reasoning.map((e) => e.text).join("")).toBe("Let me count.");
    // The signature arrives on its own text-less delta; the loop keeps the last one seen.
    expect(reasoning.some((e) => e.signature === "ErUBCkYIBB")).toBe(true);
  });

  it("test_COUNTERPROOF_a_turn_with_no_thinking_reports_none", () => {
    // Without this, `thinking: { text: "" }` on every turn would look like a pass and would then
    // persist an empty unsigned block on every ordinary answer.
    const acc = new __testing__AnthropicAccumulator();
    acc.consume({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "hi" },
    } as never);
    acc.consume({ type: "message_delta", delta: { stop_reason: "end_turn" } } as never);

    expect(acc.finish().thinking).toBeUndefined();
  });

  it("test_a_signed_thinking_block_is_replayed_on_the_wire", () => {
    const wire = toAnthropicWireMessage({
      role: "assistant",
      content: [
        { type: "thinking", text: "Let me count.", signature: "ErUBCkYIBB" },
        { type: "text", text: "Four." },
      ],
    });

    expect(wire.content).toEqual([
      { type: "thinking", thinking: "Let me count.", signature: "ErUBCkYIBB" },
      { type: "text", text: "Four." },
    ]);
  });

  it("test_an_UNSIGNED_thinking_block_is_dropped_rather_than_sent", () => {
    // An unsigned block fails the same validation as a modified one, so sending it would break the
    // whole turn instead of losing one block of context. This is the case for history recorded
    // before the fix, and for reasoning text from an OpenAI-compatible provider (never signed).
    const wire = toAnthropicWireMessage({
      role: "assistant",
      content: [
        { type: "thinking", text: "unsigned" },
        { type: "text", text: "Four." },
      ],
    });

    expect(wire.content).toEqual([{ type: "text", text: "Four." }]);
  });

  it("test_requesting_reasoning_enables_thinking_on_the_wire", () => {
    // Without the request side nothing ever issues a signature, and the whole chain is dead code.
    const body = buildAnthropicCommonBody({
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      reasoning: { effort: "high" },
    });

    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 16_384 });
    // The API rejects `max_tokens <= budget_tokens`; the ceiling is raised rather than the budget cut.
    expect(body.max_tokens).toBeGreaterThan(16_384);
  });

  it("test_COUNTERPROOF_no_reasoning_request_leaves_the_body_untouched", () => {
    const body = buildAnthropicCommonBody({
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    });

    expect(body.thinking).toBeUndefined();
    expect(body.max_tokens).toBe(4096);
  });
});
