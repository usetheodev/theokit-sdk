/**
 * T0.2 — OpenAI prompt-cache scenario (real-LLM, scaffold).
 *
 * Env-gated. OpenAI has implicit prompt caching for system prompts > 1024 tokens
 * (no opt-in flag). This scaffold sends a >1k-token system prompt twice and
 * asserts both invocations complete; expanded cache_creation_tokens vs
 * cache_read_tokens metric assertion lands in T3.8 (cache tokens telemetry).
 */

import { describe, expect, it } from "vitest";

import { Agent } from "../../../src/index.js";
import { resolveRealLlmEnv } from "./_helpers/real-llm-env.js";

const env = resolveRealLlmEnv("openai");
const LONG_SYSTEM = `You are a helpful assistant. ${"This sentence pads the system prompt to exceed the prompt-cache threshold. ".repeat(80)}`;

describe.skipIf(env.shouldSkip)(`real-llm: openai cache (${env.provider})`, () => {
  it("processes back-to-back sends with a long system prompt", async () => {
    const agent = await Agent.create({
      apiKey: env.apiKey,
      model: { id: env.model },
      systemPrompt: LONG_SYSTEM,
    });
    try {
      const r1 = await (await agent.send("Respond with 'one'.")).wait();
      const r2 = await (await agent.send("Respond with 'two'.")).wait();
      expect(r1.status).toBe("finished");
      expect(r2.status).toBe("finished");
    } finally {
      await agent.dispose();
    }
  }, 120_000);
});
