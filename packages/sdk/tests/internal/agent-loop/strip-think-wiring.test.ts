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
import type { AgentLoopInputs } from "../../../src/internal/agent-loop/types.js";
import type { LlmClient } from "../../../src/internal/llm/types.js";
import { makeTextLlm } from "../../helpers/llm-stubs.js";
import { makeLoopInputs } from "./_helpers/make-inputs.js";

/** The envelope these two files assert on: the stub reports token counts. */
const makeTextLlmWithTokens = (content: string) =>
  makeTextLlm(content, { inputTokens: 0, outputTokens: content.length });

const makeInputs = (llm: LlmClient): AgentLoopInputs =>
  makeLoopInputs({ agentId: "strip-think-wiring-test", llm });

describe("strip-think wiring (T7.2 / EC-2)", () => {
  it("strips single <think> block before returning text", async () => {
    const llm = makeTextLlmWithTokens("<think>internal reasoning here</think>Final answer.");
    const inputs = makeInputs(llm);
    const output = await runAgentLoop(inputs);
    expect(output.result).toBe("Final answer.");
    expect(output.result).not.toContain("<think>");
    expect(output.result).not.toContain("reasoning");
  });

  it("strips multiple <think> blocks", async () => {
    const llm = makeTextLlmWithTokens(
      "<think>step 1</think>visible part<think>step 2</think> end.",
    );
    const inputs = makeInputs(llm);
    const output = await runAgentLoop(inputs);
    expect(output.result).not.toContain("<think>");
    expect(output.result).toContain("visible part");
    expect(output.result).toContain("end.");
  });

  it("plain content (no think) passes through unchanged", async () => {
    const llm = makeTextLlmWithTokens("Plain response without thinking.");
    const inputs = makeInputs(llm);
    const output = await runAgentLoop(inputs);
    expect(output.result).toBe("Plain response without thinking.");
  });

  it("unclosed <think> preserved (fail-open)", async () => {
    const llm = makeTextLlmWithTokens("<think>incomplete reasoning");
    const inputs = makeInputs(llm);
    const output = await runAgentLoop(inputs);
    // Preserved — strip-think doesn't strip unclosed blocks.
    expect(output.result).toContain("<think>");
  });
});
