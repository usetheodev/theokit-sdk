/**
 * Integration test for strip-think wiring in the agent loop (T7.2 / EC-2 fix).
 *
 * Validates that `<think>...</think>` blocks emitted by a model are
 * stripped before they enter the assistant text returned by the loop.
 * Uses a mock LlmClient — production Gemini/gpt-4o-mini don't emit
 * `<think>` blocks, so live probe is non-realizable (only DeepSeek-R1 /
 * Qwen-QwQ do).
 */

import { describe, expect, it } from "vitest";

import { runAgentLoop } from "../../../src/internal/agent-loop/loop.js";
import type { AgentLoopInputs } from "../../../src/internal/agent-loop/loop-types.js";
import type { LlmClient, LlmEvent, LlmFinish } from "../../../src/internal/llm/types.js";
import { HooksExecutor } from "../../../src/internal/runtime/hooks-executor.js";

function makeMockLlm(content: string): LlmClient {
  return {
    name: "mock",
    async *stream(): AsyncGenerator<LlmEvent, LlmFinish, void> {
      yield { type: "text_delta", text: content };
      return {
        stopReason: "end_turn",
        text: content,
        toolCalls: [],
        inputTokens: 0,
        outputTokens: content.length,
      };
    },
  };
}

function makeInputs(llm: LlmClient): AgentLoopInputs {
  return {
    agentId: "strip-think-wiring-test",
    runId: "run-1",
    userMessage: "hi",
    model: { id: "mock-model" },
    llm,
    mcp: new Map(),
    hooks: new HooksExecutor(process.cwd()),
    shellCwd: process.cwd(),
    shellSandbox: false,
  };
}

describe("strip-think wiring (T7.2 / EC-2)", () => {
  it("strips single <think> block before returning text", async () => {
    const llm = makeMockLlm("<think>internal reasoning here</think>Final answer.");
    const inputs = makeInputs(llm);
    const output = await runAgentLoop(inputs);
    expect(output.result).toBe("Final answer.");
    expect(output.result).not.toContain("<think>");
    expect(output.result).not.toContain("reasoning");
  });

  it("strips multiple <think> blocks", async () => {
    const llm = makeMockLlm("<think>step 1</think>visible part<think>step 2</think> end.");
    const inputs = makeInputs(llm);
    const output = await runAgentLoop(inputs);
    expect(output.result).not.toContain("<think>");
    expect(output.result).toContain("visible part");
    expect(output.result).toContain("end.");
  });

  it("plain content (no think) passes through unchanged", async () => {
    const llm = makeMockLlm("Plain response without thinking.");
    const inputs = makeInputs(llm);
    const output = await runAgentLoop(inputs);
    expect(output.result).toBe("Plain response without thinking.");
  });

  it("unclosed <think> preserved (fail-open)", async () => {
    const llm = makeMockLlm("<think>incomplete reasoning");
    const inputs = makeInputs(llm);
    const output = await runAgentLoop(inputs);
    // Preserved — strip-think doesn't strip unclosed blocks.
    expect(output.result).toContain("<think>");
  });
});
