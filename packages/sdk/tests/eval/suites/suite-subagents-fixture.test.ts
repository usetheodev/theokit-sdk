/**
 * Eval suite — subagent (a2a) delegation via FIXTURE MODE (deterministic).
 *
 * A `theo_test_*` API key runs the REAL local agent pipeline but returns
 * baked-in fixture responses (documented contract, like Stripe test keys), so
 * this suite exercises the subagent-delegation path end to end with zero token
 * spend. The `"Spawn reviewer and worker subagents"` prompt makes the fixture
 * echo one deterministic line per inline `agents:` definition:
 *
 *   Spawning subagents:
 *   - <name> (<description>): <prompt>
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, it } from "vitest";

import { assertEval, Eval, Scorers } from "../../../src/eval.js";
import { removeTempDirRobustSync } from "../../helpers/temp-workspace.js";

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

const FIXTURE_AGENT = {
  apiKey: "theo_test_eval",
  model: { id: "openai/gpt-4o-mini" },
  agents: {
    reviewer: {
      description: "Reviews code changes for regressions",
      prompt: "You are the reviewer subagent.",
    },
    worker: {
      description: "Executes assigned build tasks",
      prompt: "You are the worker subagent.",
    },
  },
  local: { cwd: EVAL_CWD, sandboxOptions: { enabled: false } as const },
} as const;

describe("eval suite: subagent delegation (fixture mode)", () => {
  it("delegates to inline reviewer + worker subagents and clears the gate", async () => {
    const run = await Eval.create({
      name: "fixture-spawn-subagents",
      dataset: [
        {
          input: "Spawn reviewer and worker subagents.",
          expected: "Spawning subagents:",
        },
      ],
      scorers: [
        Scorers.containsExpected(),
        Scorers.regex(
          /- reviewer \(Reviews code changes for regressions\): You are the reviewer subagent\./,
        ),
        Scorers.regex(/- worker \(Executes assigned build tasks\): You are the worker subagent\./),
      ],
      agent: FIXTURE_AGENT,
      concurrency: 1,
    }).run();

    assertEval(run, { minMeanScore: 1, minPassRatio: 1, maxErrorRatio: 0 });
  });
});
