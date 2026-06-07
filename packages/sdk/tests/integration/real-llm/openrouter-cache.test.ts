/**
 * T0.2 — OpenRouter prompt-cache scenario (real-LLM, scaffold).
 *
 * Env-gated by OPENROUTER_API_KEY. OpenRouter exposes prompt-cache info via
 * the underlying model's native capability. This scaffold validates the wire
 * survives OpenRouter routing; T3.8 telemetry tokens assertion comes later.
 */

import { describe, expect, it } from "vitest";

import { Agent } from "../../../src/index.js";
import { resolveRealLlmEnv } from "./_helpers/real-llm-env.js";

const env = resolveRealLlmEnv("openrouter");
const LONG_SYSTEM = `You are a helpful assistant. ${"Padding line to push the prompt past cache-eligibility. ".repeat(80)}`;

describe.skipIf(env.shouldSkip)(`real-llm: openrouter cache (${env.provider})`, () => {
  it("completes two back-to-back sends via OpenRouter", async () => {
    const agent = await Agent.create({
      apiKey: env.apiKey,
      model: { id: env.model },
      systemPrompt: LONG_SYSTEM,
    });
    try {
      const r1 = await (await agent.send("Reply 'one'.")).wait();
      const r2 = await (await agent.send("Reply 'two'.")).wait();
      expect(r1.status).toBe("finished");
      expect(r2.status).toBe("finished");
    } finally {
      await agent.dispose();
    }
  }, 120_000);
});
