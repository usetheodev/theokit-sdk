/**
 * issue #47 — the SDK must forward a reasoning request to OpenRouter (OpenAI-compat) and surface
 * the returned `delta.reasoning` as `reasoning_delta` events. Before this, `ModelSelection.params`
 * (the `thinking` param) was dropped entirely, so reasoning was never requested or surfaced.
 *
 * Review fast-follow (cycle-review NEEDS_FIXES): the request shape is now provider-specific
 * (F-domain-1: native OpenAI wants top-level `reasoning_effort`, OpenRouter wants `reasoning:{effort}`);
 * reasoning must stay OUT of the visible answer (F-tests-1); and `delta.reasoning_content` is accepted
 * as the sibling field used by some compat providers (F-domain-2).
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

describe("issue #47 — OpenRouter / OpenAI-compat reasoning request body", () => {
  it("test_buildOpenAIBody_uses_unified_object_for_openrouter", () => {
    const body = __testing__buildOpenAIBody(
      { ...baseReq, reasoning: { effort: "high" } },
      "openrouter",
    );
    expect(body.reasoning).toEqual({ effort: "high" });
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("test_buildOpenAIBody_uses_top_level_reasoning_effort_for_native_openai", () => {
    // F-domain-1: native OpenAI Chat Completions rejects the `reasoning` object — it wants the
    // top-level `reasoning_effort` string. Sending the wrong shape would 400.
    const body = __testing__buildOpenAIBody(
      { ...baseReq, reasoning: { effort: "high" } },
      "openai",
    );
    expect(body.reasoning_effort).toBe("high");
    expect(body.reasoning).toBeUndefined();
  });

  it("test_buildOpenAIBody_defaults_to_unified_object_when_provider_unspecified", () => {
    const body = __testing__buildOpenAIBody({ ...baseReq, reasoning: { effort: "low" } });
    expect(body.reasoning).toEqual({ effort: "low" });
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("test_buildOpenAIBody_omits_reasoning_when_absent", () => {
    const openrouter = __testing__buildOpenAIBody(baseReq, "openrouter");
    expect(openrouter.reasoning).toBeUndefined();
    expect(openrouter.reasoning_effort).toBeUndefined();
    const openai = __testing__buildOpenAIBody(baseReq, "openai");
    expect(openai.reasoning).toBeUndefined();
    expect(openai.reasoning_effort).toBeUndefined();
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

  it("test_consume_emits_reasoning_delta_from_delta_reasoning_content", () => {
    // F-domain-2: sibling field used by DeepSeek-direct / vLLM / LMStudio reasoning parsers.
    const acc = new __testing__OpenAIStreamAccumulator();
    const events = acc.consume({
      choices: [{ index: 0, delta: { reasoning_content: "compat reasoning" } }],
    });
    expect(events).toContainEqual({ type: "reasoning_delta", text: "compat reasoning" });
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

  it("test_reasoning_is_not_accumulated_into_visible_answer", () => {
    // F-tests-1 (HIGH): the central safety invariant — reasoning (chain-of-thought) must NEVER leak
    // into finish().text (the visible answer the consumer renders).
    const acc = new __testing__OpenAIStreamAccumulator();
    acc.consume({ choices: [{ index: 0, delta: { reasoning: "secret chain of thought" } }] });
    acc.consume({ choices: [{ index: 0, delta: { content: "42" } }] });
    expect(acc.finish().text).toBe("42");
  });

  it("test_reasoning_only_stream_yields_empty_visible_answer", () => {
    // F-tests-1: a stream that only carried reasoning produces no visible text.
    const acc = new __testing__OpenAIStreamAccumulator();
    acc.consume({ choices: [{ index: 0, delta: { reasoning: "thinking, no answer yet" } }] });
    expect(acc.finish().text).toBe("");
  });

  it("test_consume_ignores_empty_reasoning_and_content_only_chunks", () => {
    // F-tests-3: empty reasoning emits nothing; a content-only chunk emits no reasoning_delta.
    const acc = new __testing__OpenAIStreamAccumulator();
    expect(acc.consume({ choices: [{ index: 0, delta: { reasoning: "" } }] })).toEqual([]);
    const events = acc.consume({ choices: [{ index: 0, delta: { content: "hello" } }] });
    expect(events.some((e) => e.type === "reasoning_delta")).toBe(false);
    expect(events).toContainEqual({ type: "text_delta", text: "hello" });
  });
});
