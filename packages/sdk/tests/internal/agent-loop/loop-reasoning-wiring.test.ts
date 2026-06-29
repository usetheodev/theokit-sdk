/**
 * issue #47 — loop-layer wiring (cycle-review F-tests-2, HIGH).
 *
 * The leaf functions (buildOpenAIBody / reasoningEffortFromParams / accumulator) are unit-tested in
 * openai-reasoning.test.ts. This test covers the integration the user actually sees: `streamLlmTurn`
 *  1. forwards `reasoning: { effort }` into the provider request when the `thinking` param is present,
 *     and leaves the request bare when it is absent;
 *  2. surfaces reasoning live via `onDelta` as a `thinking-delta` update, BEFORE the visible text-delta;
 *  3. replays the accumulated reasoning as a `thinking` SDKMessage on `ctx.events`;
 *  4. keeps reasoning OUT of the returned visible answer (`output.text`).
 */
import { describe, expect, it } from "vitest";
import type { LoopContext } from "../../../src/internal/agent-loop/loop-context-init.js";
import { streamLlmTurn } from "../../../src/internal/agent-loop/loop-llm-stream.js";
import type { AgentLoopInputs } from "../../../src/internal/agent-loop/loop-types.js";
import type {
  LlmClient,
  LlmEvent,
  LlmFinish,
  LlmRequest,
} from "../../../src/internal/llm/types.js";

function fakeLlm(events: LlmEvent[], capture?: (req: LlmRequest) => void): LlmClient {
  return {
    name: "openrouter",
    async *stream(request: LlmRequest): AsyncGenerator<LlmEvent, LlmFinish, void> {
      capture?.(request);
      for (const e of events) yield e;
      return { stopReason: "end_turn", text: "", toolCalls: [] };
    },
  };
}

function makeInputs(
  llm: LlmClient,
  params: Array<{ id: string; value: string }> | undefined,
  updates: Array<{ type: string; text?: string }>,
): AgentLoopInputs {
  return {
    agentId: "agent-test",
    runId: "run-test",
    model: { id: "deepseek/deepseek-r1", params },
    userMessage: "hi",
    llm,
    onDelta: (payload: { update: { type: string; text?: string } }) => {
      updates.push(payload.update);
    },
  } as unknown as AgentLoopInputs;
}

function makeCtx(): LoopContext {
  return {
    messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    tools: [],
    events: [],
    memorySystemPromptAdditions: undefined,
  } as unknown as LoopContext;
}

const REASON_THEN_ANSWER: LlmEvent[] = [
  { type: "reasoning_delta", text: "step 1: " },
  { type: "reasoning_delta", text: "compute 17*23" },
  { type: "text_delta", text: "The answer is 391." },
];

describe("issue #47 — streamLlmTurn reasoning wiring", () => {
  it("test_forwards_reasoning_effort_when_thinking_param_present", async () => {
    let captured: LlmRequest | undefined;
    const llm = fakeLlm(REASON_THEN_ANSWER, (req) => {
      captured = req;
    });
    await streamLlmTurn(makeInputs(llm, [{ id: "thinking", value: "high" }], []), makeCtx());
    expect(captured?.reasoning).toEqual({ effort: "high" });
  });

  it("test_request_stays_bare_when_no_thinking_param", async () => {
    let captured: LlmRequest | undefined;
    const llm = fakeLlm(REASON_THEN_ANSWER, (req) => {
      captured = req;
    });
    await streamLlmTurn(makeInputs(llm, undefined, []), makeCtx());
    expect(captured?.reasoning).toBeUndefined();
  });

  it("test_surfaces_thinking_delta_live_before_text_delta", async () => {
    const updates: Array<{ type: string; text?: string }> = [];
    const llm = fakeLlm(REASON_THEN_ANSWER);
    await streamLlmTurn(makeInputs(llm, [{ id: "thinking", value: "high" }], updates), makeCtx());
    const thinking = updates.filter((u) => u.type === "thinking-delta");
    const text = updates.filter((u) => u.type === "text-delta");
    expect(thinking.map((u) => u.text)).toEqual(["step 1: ", "compute 17*23"]);
    expect(text.map((u) => u.text)).toEqual(["The answer is 391."]);
    // reason-then-answer order preserved live.
    const firstThinking = updates.findIndex((u) => u.type === "thinking-delta");
    const firstText = updates.findIndex((u) => u.type === "text-delta");
    expect(firstThinking).toBeLessThan(firstText);
  });

  it("test_pushes_thinking_sdkmessage_with_accumulated_reasoning", async () => {
    const ctx = makeCtx();
    const llm = fakeLlm(REASON_THEN_ANSWER);
    await streamLlmTurn(makeInputs(llm, [{ id: "thinking", value: "high" }], []), ctx);
    const thinkingEvents = ctx.events.filter((e) => e.type === "thinking");
    expect(thinkingEvents).toHaveLength(1);
    expect((thinkingEvents[0] as { text: string }).text).toBe("step 1: compute 17*23");
  });

  it("test_visible_answer_excludes_reasoning", async () => {
    const llm = fakeLlm(REASON_THEN_ANSWER);
    const output = await streamLlmTurn(
      makeInputs(llm, [{ id: "thinking", value: "high" }], []),
      makeCtx(),
    );
    expect(output.text).toBe("The answer is 391.");
    expect(output.errored).toBe(false);
  });

  it("test_no_thinking_event_when_model_returns_no_reasoning", async () => {
    const ctx = makeCtx();
    const llm = fakeLlm([{ type: "text_delta", text: "plain answer" }]);
    const output = await streamLlmTurn(
      makeInputs(llm, [{ id: "thinking", value: "high" }], []),
      ctx,
    );
    expect(ctx.events.some((e) => e.type === "thinking")).toBe(false);
    expect(output.text).toBe("plain answer");
  });
});
