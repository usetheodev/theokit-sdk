/**
 * SE41 eval suite — STRUCTURED output over OpenRouter (gated, real LLM).
 *
 * Skipped unless a provider key is present. Evaluates whether the model returns
 * schema-valid JSON via `Scorers.jsonShape`. Real-LLM output is non-deterministic
 * so the gate is lenient (`minPassRatio`) and each row runs 2 trials.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { assertEval, Eval, Scorers } from "../../../src/eval.js";
import { removeTempDirRobustSync } from "../../helpers/temp-workspace.js";
import { resolveRealLlmEnv } from "../../integration/real-llm/_helpers/real-llm-env.js";

/**
 * A temp cwd, not `process.cwd()`.
 *
 * `process.cwd()` during a vitest run is `packages/sdk` itself, so every agent created here
 * persisted a real session under the repository. Nothing in this suite reads from the repo, so the
 * process cwd was incidental — and it cost 540 MB of `.theokit/` residue across the checkout before
 * anyone measured it. `.gitignore` hides that directory, which is why it never showed up in a diff
 * or in CI. The gate that now catches a recurrence is `vitest.global-setup.ts`.
 */
const EVAL_CWD = mkdtempSync(join(tmpdir(), "theokit-eval-suite-"));
afterAll(() => {
  removeTempDirRobustSync(EVAL_CWD);
});

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
        local: { cwd: EVAL_CWD, sandboxOptions: { enabled: false } as const },
      },
      concurrency: 2,
      trials: 2,
    }).run();

    // Lenient gate — structured-output compliance varies by model/run.
    assertEval(run, { minPassRatio: 0.5, maxErrorRatio: 0 });
    expect(run.aggregate.passRatio).toBeGreaterThanOrEqual(0.5);
  }, 90_000);
});
