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

import { describe, it } from "vitest";

import { assertEval, Eval, Scorers } from "../../../src/eval.js";

const FIXTURE_AGENT = {
  apiKey: "theo_test_eval",
  model: { id: "openai/gpt-4o-mini" },
  mcpServers: {
    inlineHttp: {
      type: "http" as const,
      url: "https://mcp.example.test",
    },
  },
  local: { cwd: process.cwd(), sandboxOptions: { enabled: false } as const },
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
