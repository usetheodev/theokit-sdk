import { afterEach, describe, expect, it } from "vitest";

import { Agent, type AgentOptions } from "../../src/index.js";
import { createTempWorkspace, type TempWorkspace, useTempCwd } from "../helpers/temp-workspace.js";

/**
 * A cloud agent has no local working directory, so these cases pass no `local.cwd` — but the agent
 * REGISTRY still lands under `process.cwd()`, which during a test run is `packages/sdk/` itself.
 * Measured 2026-09-01: this file wrote a real `.theokit/agents/registry.json` into the package tree
 * on every run, invisible to `git status` because `.gitignore` hides it.
 *
 * Passing a `local.cwd` to a cloud agent would be a lie about what the agent is; redirecting
 * `process.cwd()` for the file is the honest fix, and is why this helper exists.
 */
useTempCwd();

describe("hooks contract", () => {
  let workspace: TempWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
    workspace = undefined;
  });

  it("local agents load file-based .theokit/hooks.json and do not expose programmatic hook callbacks", async () => {
    workspace = await createTempWorkspace("project-with-hooks");
    const options = {
      apiKey: "theo_test_contract_key",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd: workspace.cwd, settingSources: ["project"] },
      hooks: { preRun: () => undefined },
    } as unknown as AgentOptions;

    await expect(Agent.create(options)).rejects.toMatchObject({
      name: "ConfigurationError",
      message: expect.stringMatching(/hooks.*file|programmatic/i),
    });

    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd: workspace.cwd, settingSources: ["project"] },
    });
    const run = await agent.send("Run with file-based preRun hook.");
    await expect(run.wait()).resolves.toMatchObject({ status: "finished" });
  });

  it("invalid hook files fail loudly with ConfigurationError", async () => {
    workspace = await createTempWorkspace("project-with-hooks");
    await workspace.writeText(".theokit/hooks.json", "{ invalid json");

    await expect(
      Agent.create({
        apiKey: "theo_test_contract_key",
        model: { id: "google/gemini-2.0-flash-001" },
        local: { cwd: workspace.cwd, settingSources: ["project"] },
      }),
    ).rejects.toMatchObject({
      name: "ConfigurationError",
      message: expect.stringMatching(/hooks/i),
    });
  });

  it("cloud requires hooks to come from committed repo files", async () => {
    await expect(
      Agent.create({
        apiKey: "theo_test_contract_key",
        model: { id: "google/gemini-2.0-flash-001" },
        cloud: { repos: [{ url: "https://github.com/usetheo/example" }] },
      }),
    ).resolves.toMatchObject({
      agentId: expect.stringMatching(/^bc-/),
    });
  });
});
