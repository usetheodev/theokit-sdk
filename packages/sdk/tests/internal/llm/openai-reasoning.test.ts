/**
 * issue #47 — the SDK must forward a reasoning request to OpenRouter (OpenAI-compat) and surface
 * the returned `delta.reasoning` as `reasoning_delta` events. Before this, `ModelSelection.params`
 * (the `thinking` param) was dropped entirely, so reasoning was never requested or surfaced.
 */
import { describe, expect, it } from "vitest";
import { reasoningEffortFromParams } from "../../../src/internal/agent-loop/loop-llm-stream.js";
import {
  __testing__buildOpenAIBody,
  __testing__OpenAIStreamAccumulator,
} from "../../../src/internal/llm/openai.js";
import type { LlmRequest } from "../../../src/internal/llm/types.js";

const baseReq: LlmRequest = {
  model: "deepseek/deepseek-r1",
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
};

describe("issue #47 — OpenRouter reasoning request body", () => {
  it("test_buildOpenAIBody_adds_reasoning_when_effort_set", () => {
    const body = __testing__buildOpenAIBody({ ...baseReq, reasoning: { effort: "high" } });
    expect(body.reasoning).toEqual({ effort: "high" });
  });

  it("test_buildOpenAIBody_omits_reasoning_when_absent", () => {
    const body = __testing__buildOpenAIBody(baseReq);
    expect(body.reasoning).toBeUndefined();
  });
});

describe("issue #47 — reasoningEffortFromParams", () => {
  it("test_reasoning_effort_from_thinking_param", () => {
    expect(reasoningEffortFromParams([{ id: "thinking", value: "high" }])).toBe("high");
  });

  it("test_reasoning_effort_undefined_when_no_thinking_param", () => {
    expect(reasoningEffortFromParams(undefined)).toBeUndefined();
    expect(reasoningEffortFromParams([{ id: "other", value: "x" }])).toBeUndefined();
    expect(reasoningEffortFromParams([{ id: "thinking", value: "" }])).toBeUndefined();
  });
});

describe("issue #47 — OpenRouter reasoning-delta parsing", () => {
  it("test_consume_emits_reasoning_delta_from_delta_reasoning", () => {
    const acc = new __testing__OpenAIStreamAccumulator();
    const events = acc.consume({ choices: [{ index: 0, delta: { reasoning: "thinking..." } }] });
    expect(events).toContainEqual({ type: "reasoning_delta", text: "thinking..." });
  });

  it("test_consume_separates_reasoning_from_text", () => {
    const acc = new __testing__OpenAIStreamAccumulator();
    const events = acc.consume({
      choices: [{ index: 0, delta: { reasoning: "r", content: "answer" } }],
    });
    expect(events).toContainEqual({ type: "reasoning_delta", text: "r" });
    expect(events).toContainEqual({ type: "text_delta", text: "answer" });
    // reasoning precedes the visible text in arrival order.
    expect(events.findIndex((e) => e.type === "reasoning_delta")).toBeLessThan(
      events.findIndex((e) => e.type === "text_delta"),
    );
  });
});
