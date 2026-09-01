/**
 * Eval suite — web-search tool pipeline via FIXTURE MODE (deterministic, always runs).
 *
 * A `theo_test_*` API key runs the REAL local agent pipeline but returns
 * baked-in fixture responses (documented contract, like Stripe test keys), so
 * this suite exercises `Eval.create` -> `Agent.batch` -> run -> scorer ->
 * `assertEval` end to end against the web-search capability with zero token spend.
 *
 * The prompt "Search docs for SDK contract testing patterns." dispatches to
 * `webSearchScript` (see `internal/runtime/fixtures/fixture-responder.ts`), which
 * emits a `mcp_search_provider_web_search` tool call and finishes with the exact,
 * deterministic assistant result "Search complete." Everything else mirrors the
 * QA fixture suite: `theo_test_eval` key, `openai/gpt-4o-mini`, sandbox off.
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
  local: { cwd: EVAL_CWD, sandboxOptions: { enabled: false } as const },
} as const;

describe("eval suite: web-search tool pipeline (fixture mode)", () => {
  it("runs the web-search pipeline and returns the deterministic result, clearing the gate", async () => {
    const run = await Eval.create({
      name: "fixture-websearch",
      dataset: [
        {
          input: "Search docs for SDK contract testing patterns.",
          expected: "Search complete.",
        },
      ],
      scorers: [
        Scorers.exactMatch(),
        Scorers.containsExpected(),
        Scorers.regex(/search complete/i),
      ],
      agent: FIXTURE_AGENT,
      concurrency: 1,
    }).run();

    assertEval(run, { minMeanScore: 1, minPassRatio: 1, maxErrorRatio: 0 });
    expect(run.aggregate.errorRows).toBe(0);
    expect(run.aggregate.totalRows).toBe(1);
  });
});
