/**
 * SE41 eval suite — agent QA via FIXTURE MODE (deterministic, always runs).
 *
 * A `theo_test_*` API key runs the REAL local agent pipeline but returns
 * baked-in fixture responses (documented contract, like Stripe test keys), so
 * this suite exercises `Agent.batch` → run → scorer → `assertEval` end to end
 * with zero token spend. `"Return only: X"` makes the agent echo `X`.
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

describe("eval suite: agent QA (fixture mode)", () => {
  it("instruction-following: 'Return only: X' echoes X and clears the gate", async () => {
    const run = await Eval.create({
      name: "fixture-return-only",
      dataset: [
        { input: "Return only: Paris", expected: "Paris" },
        { input: "Return only: 42", expected: "42" },
        { input: "Return only: cold", expected: "cold" },
      ],
      scorers: [Scorers.exactMatch(), Scorers.levenshtein({ threshold: 0.9 })],
      agent: FIXTURE_AGENT,
      concurrency: 2,
    }).run();

    assertEval(run, { minMeanScore: 1, minPassRatio: 1, maxErrorRatio: 0 });
    expect(run.aggregate.errorRows).toBe(0);
    expect(run.aggregate.totalRows).toBe(3);
  });
});
