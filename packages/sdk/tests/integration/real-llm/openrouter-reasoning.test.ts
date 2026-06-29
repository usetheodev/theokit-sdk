/**
 * issue #47 — OpenRouter reasoning scenario (real-LLM).
 *
 * Env-gated by OPENROUTER_API_KEY. Proves the end-to-end reasoning path the fix exists for:
 * a `thinking` param on `ModelSelection.params` makes the SDK request reasoning from OpenRouter
 * (`reasoning: { effort }`), and the streamed `delta.reasoning` surfaces as `thinking-delta`
 * InteractionUpdates (live, via `onDelta`) plus `thinking` SDKMessages (via `Run.stream`) — on a
 * separate channel from the visible answer.
 *
 * Per `.claude/rules/real-llm-validation.md` this is the committable, repeatable evidence that the
 * unit-tested wiring actually produces reasoning against a real reasoning model (deepseek-r1).
 */

import { describe, expect, it } from "vitest";

import type { Run } from "../../../src/index.js";
import { Agent } from "../../../src/index.js";
import { resolveRealLlmEnv } from "./_helpers/real-llm-env.js";

const env = resolveRealLlmEnv("openrouter", { model: "deepseek/deepseek-r1" });

/** Drain the run stream, separating reasoning (`thinking`) messages from the visible answer. */
async function drainRun(run: Run): Promise<{ thinkingMessages: number; answerText: string }> {
  let thinkingMessages = 0;
  let answerText = "";
  for await (const event of run.stream()) {
    if (event.type === "thinking") {
      thinkingMessages += 1;
    } else if (event.type === "assistant") {
      answerText += event.message.content
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("");
    }
  }
  return { thinkingMessages, answerText };
}

describe.skipIf(env.shouldSkip)(`real-llm: openrouter reasoning (${env.provider})`, () => {
  it("surfaces reasoning as thinking-delta + thinking messages, separate from the answer", async () => {
    const agent = await Agent.create({
      apiKey: env.apiKey,
      model: { id: env.model, params: [{ id: "thinking", value: "high" }] },
      // deepseek-r1 is an OpenRouter slug — route the chat capability to OpenRouter so the full
      // `deepseek/deepseek-r1` id is sent (prefix inference would otherwise pick a bare provider).
      providers: { routes: [{ capability: "chat", provider: "openrouter" }] },
    });
    try {
      let thinkingDeltas = 0;
      let reasoningText = "";
      const run = await agent.send("What is 17 * 23? Reason step by step, then answer.", {
        onDelta: ({ update }) => {
          if (update.type === "thinking-delta") {
            thinkingDeltas += 1;
            reasoningText += update.text;
          }
        },
      });
      const { thinkingMessages, answerText } = await drainRun(run);
      await run.wait();

      // Reasoning was actually produced and surfaced on its own channel.
      expect(thinkingDeltas).toBeGreaterThan(0);
      expect(thinkingMessages).toBeGreaterThan(0);
      expect(reasoningText.length).toBeGreaterThan(0);
      // The visible answer is non-empty and does NOT simply equal the chain-of-thought.
      expect(answerText.length).toBeGreaterThan(0);
      expect(answerText).not.toBe(reasoningText);
    } finally {
      await agent.dispose();
    }
  }, 90_000);
});
