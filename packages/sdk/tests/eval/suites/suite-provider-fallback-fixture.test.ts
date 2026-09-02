/**
 * Eval suite — provider fallback resilience via FIXTURE MODE (deterministic, always runs).
 *
 * A `theo_test_*` API key runs the REAL local agent pipeline but returns
 * baked-in fixture responses (documented contract, like Stripe test keys), so
 * this suite exercises `Eval.create` -> `Agent.batch` -> run -> scorer ->
 * `assertEval` end to end against the provider-fallback capability with zero
 * token spend.
 *
 * The prompt "Use provider fallback." dispatches to `providerFallbackScript`
 * (see `internal/runtime/fixtures/fixture-responder.ts`), which finishes with the
 * exact, deterministic assistant result "Falling back to alternate provider."
 * and attaches routing metadata to the run. The run FINISHES (no error row), so
 * the resilience path is graded on both the output text and a zero error rate.
 * Everything else mirrors the QA fixture suite: `theo_test_eval` key,
 * `openai/gpt-4o-mini`, sandbox off.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { assertEval, Eval, Scorers } from "../../../src/eval.js";
import { removeTempDirRobustSync } from "../../helpers/temp-workspace.js";

/**
 * A temp cwd, not `process.cwd()`.
 *
 * `process.cwd()` during a vitest run is `packages/sdk` itself, so every agent this suite creates
 * persisted a real session under the repository. Nothing here reads from the repo — the fixture
 * responses come from the `theo_test_*` key, not from anything on disk — so the process cwd was
 * incidental, and it cost 540 MB of `.theokit/` residue across the checkout before anyone measured
 * it. `.gitignore` hides that directory, which is why it never showed up in a diff or in CI.
 */
const EVAL_CWD = mkdtempSync(join(tmpdir(), "theokit-eval-suite-"));
afterAll(() => {
  removeTempDirRobustSync(EVAL_CWD);
});

const FIXTURE_AGENT = {
  apiKey: "theo_test_eval",
  model: { id: "openai/gpt-4o-mini" },
  local: { cwd: EVAL_CWD, sandboxOptions: { enabled: false } as const },
} as const;

describe("eval suite: provider fallback resilience (fixture mode)", () => {
  it("falls back and finishes with the deterministic result, clearing the gate with zero errors", async () => {
    const run = await Eval.create({
      name: "fixture-provider-fallback",
      dataset: [
        {
          input: "Use provider fallback.",
          expected: "Falling back to alternate provider.",
        },
      ],
      scorers: [Scorers.exactMatch(), Scorers.containsExpected(), Scorers.regex(/falling back/i)],
      agent: FIXTURE_AGENT,
      concurrency: 1,
    }).run();

    assertEval(run, { minMeanScore: 1, minPassRatio: 1, maxErrorRatio: 0 });
    expect(run.aggregate.errorRows).toBe(0);
    expect(run.aggregate.totalRows).toBe(1);
  });
});
