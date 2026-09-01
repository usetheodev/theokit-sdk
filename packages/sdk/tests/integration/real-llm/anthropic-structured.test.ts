/**
 * T0.2 — Anthropic structured-outputs scenario (real-LLM, scaffold).
 *
 * Env-gated. Uses synthetic forced-tool path (ADR D33) for structured outputs
 * since Anthropic does not have a native response_format json_schema. T3.6
 * adds OpenAI-native flag; Anthropic remains forced-tool.
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

const env = resolveRealLlmEnv("anthropic");

describe.skipIf(env.shouldSkip)(`real-llm: anthropic structured (${env.provider})`, () => {
  it("returns a typed object via synthetic forced tool", async () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });
    const result = await Agent.generateObject({
      apiKey: env.apiKey,
      model: { id: env.model },
      prompt: "Generate a typed JSON object with name='Ada' and age=37.",
      schema,
      local: { cwd: process.cwd() },
    });
    expect(result.object.name).toBe("Ada");
    expect(result.object.age).toBe(37);
  }, 60_000);
});
