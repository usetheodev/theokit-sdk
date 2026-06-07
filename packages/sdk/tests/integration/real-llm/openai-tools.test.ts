/**
 * T0.2 — OpenAI tools scenario (real-LLM).
 *
 * Env-gated: requires OPENAI_API_KEY OR falls back to OPENROUTER_API_KEY for
 * the routing surface. Validates that `Agent.send` invokes a tool with the
 * canonical OpenAI tool_use shape and that the tool result loops back to the
 * LLM for a final answer.
 *
 * Expanded coverage (full tool-loop matrix, error retries, parallel calls)
 * lands in T6.1 — this scaffold ships one happy-path assertion.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { Agent, defineTool } from "../../../src/index.js";
import { resolveRealLlmEnv } from "./_helpers/real-llm-env.js";

const env = resolveRealLlmEnv("openai");

describe.skipIf(env.shouldSkip)(`real-llm: openai tools (${env.provider})`, () => {
  it("invokes a tool and returns a final answer", async () => {
    let toolCalled = 0;
    const getSecretWord = defineTool({
      name: "get_secret_word",
      description: "Returns a secret word the user is asking for.",
      inputSchema: z.object({}),
      handler: () => {
        toolCalled += 1;
        return JSON.stringify({ word: "vortex" });
      },
    });
    const agent = await Agent.create({
      apiKey: env.apiKey,
      model: { id: env.model },
      tools: [getSecretWord],
      systemPrompt:
        "You have a get_secret_word tool. When the user asks for the secret word, call the tool.",
    });
    try {
      const run = await agent.send(
        "Call the get_secret_word tool and tell me the secret word verbatim.",
      );
      const result = await run.wait();
      expect(result.status).toBe("finished");
      expect(toolCalled).toBeGreaterThanOrEqual(1);
      expect((result.result ?? "").toLowerCase()).toContain("vortex");
    } finally {
      await agent.dispose();
    }
  }, 60_000);
});
