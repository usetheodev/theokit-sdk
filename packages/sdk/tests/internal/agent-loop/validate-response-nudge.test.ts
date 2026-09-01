/**
 * T2.1 — wire `validateResponse` D93 bailout in `continueOrTerminate`.
 *
 * Bug pre-T2.1: when the LLM returns `{ stopReason: "end_turn", text: "",
 * toolCalls: [] }` (the "model bailout" shape that weak models like Gemini
 * Flash and Mistral 7B sometimes emit after a tool result), the loop
 * immediately set `finalStatus: "finished"` and returned with empty text.
 * From the user's perspective the run "finished" successfully but the
 * assistant said nothing.
 *
 * Post-T2.1: the loop detects the bailout, increments `nudgeAttempts`
 * (capped at 2), pushes a nudge user message ("continue or provide a final
 * answer"), and re-runs the LLM turn. If the model still bails after 2
 * nudges, the loop finishes (give up — break out of infinite spin).
 *
 * `validateResponse` already exists (T2.2 of arch-review-fixes-2026-06-06,
 * ADR D93) but was an orphan export with zero production callers. T2.1
 * wires it.
 */
import { describe, expect, it } from "vitest";

import { runAgentLoop } from "../../../src/internal/agent-loop/loop.js";
import type { AgentLoopInputs } from "../../../src/internal/agent-loop/loop-types.js";
import type { LlmClient, LlmEvent, LlmFinish } from "../../../src/internal/llm/types.js";
import { makeLoopInputs } from "./_helpers/make-inputs.js";

interface SequencedFinish {
  text: string;
  stopReason?: string;
}

/**
 * LLM stub that returns the given sequence of finishes, one per call.
 * Tracks the calls so the test can assert nudge attempts.
 */
function makeSequencedLlm(sequence: SequencedFinish[]): {
  llm: LlmClient;
  callCount: () => number;
} {
  let callIdx = 0;
  const llm: LlmClient = {
    name: "sequenced-mock",
    async *stream(): AsyncGenerator<LlmEvent, LlmFinish, void> {
      const entry = sequence[callIdx] ?? sequence[sequence.length - 1] ?? { text: "" };
      callIdx += 1;
      if (entry.text.length > 0) {
        yield { type: "text_delta", text: entry.text };
      }
      return {
        stopReason: (entry.stopReason ?? "end_turn") as LlmFinish["stopReason"],
        text: entry.text,
        toolCalls: [],
        inputTokens: 0,
        outputTokens: entry.text.length,
      };
    },
  };
  return { llm, callCount: () => callIdx };
}

const makeInputs = (llm: LlmClient): AgentLoopInputs =>
  makeLoopInputs({ agentId: "validate-response-nudge-test", llm });

describe("T2.1 — validateResponse D93 nudge wiring", () => {
  it("empty content + zero tool calls → loop injects nudge and re-runs LLM", async () => {
    // First turn: empty bailout. Second turn: a real answer.
    const { llm, callCount } = makeSequencedLlm([
      { text: "", stopReason: "end_turn" },
      { text: "Actually, here's a real answer.", stopReason: "end_turn" },
    ]);

    const output = await runAgentLoop(makeInputs(llm));

    expect(output.finalStatus).toBe("finished");
    expect(output.result).toContain("real answer");
    // LLM was called TWICE — first bailout triggered the nudge.
    expect(callCount()).toBe(2);
  });

  it("whitespace-only content treated as bailout (same as empty)", async () => {
    const { llm, callCount } = makeSequencedLlm([
      { text: "   \n\t  ", stopReason: "end_turn" },
      { text: "Final answer after whitespace bailout.", stopReason: "end_turn" },
    ]);

    const output = await runAgentLoop(makeInputs(llm));

    expect(output.finalStatus).toBe("finished");
    expect(output.result).toContain("Final answer");
    expect(callCount()).toBe(2);
  });

  it("nudgeAttempts caps at 2 — repeated bailout eventually finishes", async () => {
    // Returns empty content on every call (model never recovers).
    const { llm, callCount } = makeSequencedLlm([{ text: "", stopReason: "end_turn" }]);

    const output = await runAgentLoop(makeInputs(llm));

    // Loop gives up after 2 nudges → 3 total LLM calls (initial + 2 nudges).
    expect(callCount()).toBeLessThanOrEqual(3);
    expect(output.finalStatus).toBe("finished");
    expect(output.result).toBe("");
  });

  it("non-empty content does NOT trigger nudge (no extra LLM call)", async () => {
    const { llm, callCount } = makeSequencedLlm([
      { text: "First-pass answer.", stopReason: "end_turn" },
    ]);

    const output = await runAgentLoop(makeInputs(llm));

    expect(output.result).toBe("First-pass answer.");
    expect(callCount()).toBe(1);
  });
});
