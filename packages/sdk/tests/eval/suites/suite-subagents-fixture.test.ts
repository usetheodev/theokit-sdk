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

import { describe, it } from "vitest";

import { assertEval, Eval, Scorers } from "../../../src/eval.js";

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
  local: { cwd: process.cwd(), sandboxOptions: { enabled: false } as const },
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
