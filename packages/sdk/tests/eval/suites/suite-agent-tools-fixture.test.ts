/**
 * SE41 eval suite — TOOL pipeline via fixture mode (deterministic).
 *
 * "report the exported answer" drives the agent through the shell tool and
 * returns "The answer is 42." — exercising the real tool-call loop with no
 * token spend. Scored on the answer content.
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

describe("eval suite: agent tools (fixture mode)", () => {
  it("tool pipeline: agent reports the exported answer and clears the gate", async () => {
    const run = await Eval.create({
      name: "fixture-tools",
      dataset: [{ input: "report the exported answer", expected: "42" }],
      scorers: [Scorers.containsExpected(), Scorers.regex(/answer/i)],
      agent: FIXTURE_AGENT,
      concurrency: 1,
    }).run();

    assertEval(run, { minPassRatio: 1, maxErrorRatio: 0 });
    expect(run.aggregate.errorRows).toBe(0);
  });
});
