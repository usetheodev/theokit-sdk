/**
 * T0.2 — OpenRouter structured-outputs scenario (real-LLM, scaffold).
 *
 * Env-gated by OPENROUTER_API_KEY. Validates the universal Agent.generateObject
 * surface (ADR D33) through OpenRouter routing. Cross-routes that work here
 * prove the structured-output API is provider-agnostic.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { Agent } from "../../../src/index.js";
import { resolveRealLlmEnv } from "./_helpers/real-llm-env.js";

const env = resolveRealLlmEnv("openrouter");

describe.skipIf(env.shouldSkip)(`real-llm: openrouter structured (${env.provider})`, () => {
  it("returns a typed object via OpenRouter routing", async () => {
    const schema = z.object({
      product: z.string(),
      price: z.number(),
    });
    const result = await Agent.generateObject({
      apiKey: env.apiKey,
      model: { id: env.model },
      prompt: 'Generate a typed JSON object with product="theokit" and price=99.',
      schema,
      local: { cwd: process.cwd() },
    });
    expect(result.object.product).toBe("theokit");
    expect(result.object.price).toBe(99);
  }, 60_000);
});
