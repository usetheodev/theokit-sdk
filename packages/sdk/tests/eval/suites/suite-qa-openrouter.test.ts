/**
 * SE41 eval suite — REAL-LLM gate (opt-in, OpenRouter).
 *
 * Skipped unless `OPENROUTER_API_KEY` (or a provider key) is present, mirroring
 * `tests/integration/real-llm/**`. Run for real by the `eval` workflow (which
 * injects the repo secret) or locally via `OPENROUTER_API_KEY=... pnpm eval`.
 * The key is read from the environment and never persisted.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

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

describe.skipIf(live.shouldSkip)("eval suite: QA over OpenRouter (gated)", () => {
  it("a small QA set clears the pass-ratio floor", async () => {
    const run = await Eval.create({
      name: "suite-qa-openrouter",
      dataset: [
        { input: "Answer with a single word: the capital of France.", expected: "Paris" },
        { input: "Answer with a single word: the capital of Japan.", expected: "Tokyo" },
        { input: "Answer with just the number: what is 2 + 2?", expected: "4" },
      ],
      scorers: [Scorers.containsExpected({ caseSensitive: false })],
      agent: {
        apiKey: live.apiKey,
        model: { id: live.model },
        local: { cwd: EVAL_CWD, sandboxOptions: { enabled: false } as const },
      },
      concurrency: 2,
      // Smooth single-model non-determinism: each row runs twice, gate on the mean.
      trials: 2,
    }).run();

    // The CI gate: throws EvalThresholdError (fails the job) on regression.
    assertEval(run, { minPassRatio: 0.6, maxErrorRatio: 0 });
    expect(run.aggregate.passRatio).toBeGreaterThanOrEqual(0.6);
  }, 90_000);
});
