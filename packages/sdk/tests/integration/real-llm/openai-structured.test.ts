/**
 * T0.2 — OpenAI structured-outputs scenario (real-LLM, scaffold).
 *
 * Env-gated. Native-only against OpenAI's response_format json_schema (T3.6).
 * This scaffold uses `Agent.generateObject` (synthetic forced-tool path ADR
 * D33) which is the universal portable shape. T3.6 swaps to native
 * response_format when OPENAI_API_KEY is present and asserts strict-typed
 * coercion.
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

const env = resolveRealLlmEnv("openai");

describe.skipIf(env.shouldSkip)(`real-llm: openai structured (${env.provider})`, () => {
  it("returns a typed object matching the schema", async () => {
    const schema = z.object({
      city: z.string(),
      country: z.string(),
    });
    const result = await Agent.generateObject({
      apiKey: env.apiKey,
      model: { id: env.model },
      prompt: "Return city='Lisbon' and country='Portugal'.",
      schema,
      local: { cwd: process.cwd() },
    });
    expect(result.object.city).toBe("Lisbon");
    expect(result.object.country).toBe("Portugal");
  }, 60_000);
});
