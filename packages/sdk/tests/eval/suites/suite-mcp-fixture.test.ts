/**
 * Eval suite — MCP tool listing via FIXTURE MODE (deterministic).
 *
 * A `theo_test_*` API key runs the REAL local agent pipeline but returns
 * baked-in fixture responses (documented contract, like Stripe test keys), so
 * this suite exercises the MCP tool-listing path end to end with zero token
 * spend. The `"List available MCP tools"` prompt makes the fixture echo the
 * active local tool set — `shell` plus one `mcp_<name>_call` entry per inline
 * `mcpServers:` definition:
 *
 *   Active tools: shell, mcp_inlineHttp_call
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
  mcpServers: {
    inlineHttp: {
      type: "http" as const,
      url: "https://mcp.example.test",
    },
  },
  local: { cwd: EVAL_CWD, sandboxOptions: { enabled: false } as const },
} as const;

describe("eval suite: MCP tool listing (fixture mode)", () => {
  it("lists the shell tool plus the inline MCP server tool and clears the gate", async () => {
    const run = await Eval.create({
      name: "fixture-list-mcp-tools",
      dataset: [
        {
          input: "List available MCP tools.",
          expected: "Active tools: shell, mcp_inlineHttp_call",
        },
      ],
      scorers: [
        Scorers.exactMatch(),
        Scorers.containsExpected(),
        Scorers.regex(/^Active tools: shell/),
        Scorers.regex(/mcp_inlineHttp_call/),
      ],
      agent: FIXTURE_AGENT,
      concurrency: 1,
    }).run();

    assertEval(run, { minMeanScore: 1, minPassRatio: 1, maxErrorRatio: 0 });
  });
});
