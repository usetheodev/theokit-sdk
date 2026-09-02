/**
 * Eval suite — SKILL USAGE pipeline via FIXTURE MODE (deterministic, always runs).
 *
 * A `theo_test_*` API key runs the REAL local agent pipeline but returns
 * baked-in fixture responses (documented contract, like Stripe test keys), so
 * this suite exercises the skill-usage path end to end with zero token spend.
 *
 * The fixture dispatcher (`fixture-responder.ts`) matches the prompt substring
 * `"Use the code-review skill"` and builds `useSkillScript(request, "code-review")`,
 * whose deterministic result is:
 *   "Using skill: code-review (metadata only — body redacted)."
 * The output is derived from the prompt alone — it does NOT depend on on-disk
 * SKILL.md files — so no temp workspace is needed. The `skills` config below
 * mirrors the skills contract test to exercise the same capability wiring.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { assertEval, Eval, Scorers } from "../../../src/eval.js";
import { removeTempDirRobustSync } from "../../helpers/temp-workspace.js";

const EXPECTED = "Using skill: code-review (metadata only — body redacted).";

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
  skills: {
    enabled: ["code-review", "test-architect"],
  },
  local: { cwd: EVAL_CWD, sandboxOptions: { enabled: false } as const },
};

describe("eval suite: skill usage (fixture mode)", () => {
  it("'Use the code-review skill' emits metadata-only skill usage and clears the gate", async () => {
    const run = await Eval.create({
      name: "fixture-use-skill",
      dataset: [
        { input: "Use the code-review skill to review this SDK contract.", expected: EXPECTED },
        { input: "Use the code-review skill on the public API surface.", expected: EXPECTED },
        { input: "Use the code-review skill before shipping.", expected: EXPECTED },
      ],
      scorers: [
        Scorers.exactMatch(),
        Scorers.containsExpected(),
        Scorers.regex(/Using skill: code-review .*metadata only — body redacted/),
      ],
      agent: FIXTURE_AGENT,
      concurrency: 2,
    }).run();

    assertEval(run, { minMeanScore: 1, minPassRatio: 1, maxErrorRatio: 0 });
    expect(run.aggregate.errorRows).toBe(0);
    expect(run.aggregate.totalRows).toBe(3);
  });
});
