/**
 * SE41 eval suite — STRUCTURED output over OpenRouter (gated, real LLM).
 *
 * Skipped unless a provider key is present. Evaluates whether the model returns
 * schema-valid JSON via `Scorers.jsonShape`. Real-LLM output is non-deterministic
 * so the gate is lenient (`minPassRatio`) and each row runs 2 trials.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { assertEval, Eval, Scorers } from "../../../src/eval.js";
import { resolveRealLlmEnv } from "../../integration/real-llm/_helpers/real-llm-env.js";

const live = resolveRealLlmEnv("openrouter");

describe.skipIf(live.shouldSkip)("eval suite: structured output over OpenRouter (gated)", () => {
  it("model returns schema-valid JSON for a majority of rows", async () => {
    const schema = z.object({ city: z.string(), country: z.string() });
    const run = await Eval.create({
      name: "suite-structured-openrouter",
      dataset: [
        {
          input:
            "Output ONLY a compact JSON object with string keys `city` and `country` for Paris. No markdown, no code fences, no prose.",
        },
        {
          input:
            "Output ONLY a compact JSON object with string keys `city` and `country` for Tokyo. No markdown, no code fences, no prose.",
        },
      ],
      scorers: [Scorers.jsonShape(schema)],
      agent: {
        apiKey: live.apiKey,
        model: { id: live.model },
        local: { cwd: process.cwd(), sandboxOptions: { enabled: false } as const },
      },
      concurrency: 2,
      trials: 2,
    }).run();

    // Lenient gate — structured-output compliance varies by model/run.
    assertEval(run, { minPassRatio: 0.5, maxErrorRatio: 0 });
    expect(run.aggregate.passRatio).toBeGreaterThanOrEqual(0.5);
  }, 90_000);
});
