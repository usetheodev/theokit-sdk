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
import { useTempCwd } from "../../helpers/temp-workspace.js";
import { resolveRealLlmEnv } from "./_helpers/real-llm-env.js";

// This file passed `cwd: process.cwd()`, which during a test run is the package itself, so
// every agent it created persisted a real session into packages/sdk/.theokit/. The helper
// makes process.cwd() report a throwaway directory for this file only.
useTempCwd();

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
