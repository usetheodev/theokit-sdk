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
import { makeLoopInputs } from "./_helpers/make-inputs.js";

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

const makeInputs = (
  llm: LlmClient,
  params: Array<{ id: string; value: string }> | undefined,
  updates: Array<{ type: string; text?: string }>,
): AgentLoopInputs =>
  // The `as unknown as AgentLoopInputs` cast this replaced was hiding four omitted required fields,
  // not narrowing anything on purpose — the shared factory supplies them.
  makeLoopInputs({
    agentId: "agent-test",
    runId: "run-test",
    model: { id: "deepseek/deepseek-r1", params },
    llm,
    onDelta: (payload: { update: { type: string; text?: string } }) => {
      updates.push(payload.update);
    },
  } as Partial<AgentLoopInputs>);

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

  // issue #48 — the completion half of the reasoning channel (follow-up to #47).
  it("test_emits_thinking_completed_once_after_last_thinking_delta", async () => {
    const updates: Array<{ type: string; text?: string; thinkingDurationMs?: number }> = [];
    const llm = fakeLlm(REASON_THEN_ANSWER);
    await streamLlmTurn(makeInputs(llm, [{ id: "thinking", value: "high" }], updates), makeCtx());
    const completed = updates.filter((u) => u.type === "thinking-completed");
    // exactly one completion signal per reasoning block.
    expect(completed).toHaveLength(1);
    // arrives AFTER the last thinking-delta (a UI can close the reasoning block on it).
    const lastDelta = updates.map((u) => u.type).lastIndexOf("thinking-delta");
    const completedIdx = updates.map((u) => u.type).indexOf("thinking-completed");
    expect(completedIdx).toBeGreaterThan(lastDelta);
    // carries a non-negative measured duration.
    expect(typeof completed[0]?.thinkingDurationMs).toBe("number");
    expect(completed[0]?.thinkingDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("test_thinking_sdkmessage_carries_duration", async () => {
    const ctx = makeCtx();
    const llm = fakeLlm(REASON_THEN_ANSWER);
    await streamLlmTurn(makeInputs(llm, [{ id: "thinking", value: "high" }], []), ctx);
    const thinking = ctx.events.find((e) => e.type === "thinking") as
      | { thinking_duration_ms?: number }
      | undefined;
    expect(typeof thinking?.thinking_duration_ms).toBe("number");
    expect(thinking?.thinking_duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("test_no_thinking_completed_when_no_reasoning", async () => {
    const updates: Array<{ type: string }> = [];
    const llm = fakeLlm([{ type: "text_delta", text: "plain answer" }]);
    await streamLlmTurn(makeInputs(llm, [{ id: "thinking", value: "high" }], updates), makeCtx());
    expect(updates.some((u) => u.type === "thinking-completed")).toBe(false);
  });

  // issue #48 (review Finding 1) — a mid-stream THROW after some reasoning deltas must STILL
  // emit the one `thinking-completed` (finalize runs in a `finally`), so a consumer that opened
  // a reasoning block on the first delta always gets a close signal.
  it("test_emits_thinking_completed_even_when_stream_throws_mid_reasoning", async () => {
    const updates: Array<{ type: string; text?: string; thinkingDurationMs?: number }> = [];
    const throwingLlm: LlmClient = {
      name: "openrouter",
      async *stream(): AsyncGenerator<LlmEvent, LlmFinish, void> {
        yield { type: "reasoning_delta", text: "half a thought" };
        throw new Error("connection reset mid-stream");
      },
    };
    // streamLlmTurn absorbs the stream error into an `errored` result (does not reject),
    // but the reasoning channel is still closed on the way out.
    const output = await streamLlmTurn(
      makeInputs(throwingLlm, [{ id: "thinking", value: "high" }], updates),
      makeCtx(),
    );
    expect(output.errored).toBe(true);
    const completed = updates.filter((u) => u.type === "thinking-completed");
    expect(completed).toHaveLength(1);
    expect(completed[0]?.thinkingDurationMs).toBeGreaterThanOrEqual(0);
  });
});
