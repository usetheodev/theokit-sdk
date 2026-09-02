/**
 * Eval suite — PROJECT-CONTEXT answering via FIXTURE MODE (deterministic, always runs).
 *
 * A `theo_test_*` API key runs the REAL local agent pipeline but returns
 * baked-in fixture responses (documented contract, like Stripe test keys), so
 * this suite exercises the context-aware answering path end to end with zero
 * token spend.
 *
 * The fixture dispatcher (`fixture-responder.ts`) matches the prompt substring
 * `"Answer using loaded project context"` and builds `contextAwareScript`, whose
 * deterministic result is:
 *   "The project uses deterministic contract tests for the Theo SDK."
 * The output is derived from the prompt alone — it does NOT depend on on-disk
 * context files — so no temp workspace is needed. The `context` config below
 * mirrors the context-manager contract test to exercise the same wiring.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { assertEval, Eval, Scorers } from "../../../src/eval.js";
import { removeTempDirRobustSync } from "../../helpers/temp-workspace.js";

const EXPECTED = "The project uses deterministic contract tests for the Theo SDK.";

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
  context: {
    manager: "file" as const,
    maxTokens: 1200,
  },
  local: { cwd: EVAL_CWD, sandboxOptions: { enabled: false } as const },
};

describe("eval suite: project-context answering (fixture mode)", () => {
  it("'Answer using loaded project context' returns the context-aware answer and clears the gate", async () => {
    const run = await Eval.create({
      name: "fixture-context-aware",
      dataset: [
        {
          input: "Answer using loaded project context: what kind of tests are used?",
          expected: EXPECTED,
        },
        {
          input: "Answer using loaded project context: describe the testing approach.",
          expected: EXPECTED,
        },
        {
          input: "Answer using loaded project context: how is the SDK verified?",
          expected: EXPECTED,
        },
      ],
      scorers: [
        Scorers.exactMatch(),
        Scorers.containsExpected(),
        Scorers.regex(/deterministic contract tests/i),
      ],
      agent: FIXTURE_AGENT,
      concurrency: 2,
    }).run();

    assertEval(run, { minMeanScore: 1, minPassRatio: 1, maxErrorRatio: 0 });
    expect(run.aggregate.errorRows).toBe(0);
    expect(run.aggregate.totalRows).toBe(3);
  });
});
