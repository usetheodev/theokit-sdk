import { afterEach, describe, expect, it } from "vitest";

import { Agent } from "../../src/index.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";

describe("subagents contract", () => {
  let workspace: TempWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
    workspace = undefined;
  });

  it("supports file-based subagents and inline override with model inherit", async () => {
    workspace = await createTempWorkspace("project-with-subagents");
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd, settingSources: ["project"] },
      agents: {
        reviewer: {
          description: "Inline reviewer must override file-based reviewer.",
          prompt: "Use this inline reviewer prompt.",
          model: "inherit",
        },
      },
    });

    const run = await agent.send("Spawn reviewer and worker subagents.");
    const events = [];
    for await (const event of run.stream()) events.push(event);

    const text = JSON.stringify(events);
    expect(text).toContain("Inline reviewer must override file-based reviewer");
    expect(text).toContain("worker");
    expect(text).not.toContain("Reviews code for contract regressions");
  });

  it("rejects invalid inline subagents with missing prompt or description", async () => {
    workspace = await createTempWorkspace("project-with-subagents");

    await expect(
      Agent.create({
        apiKey: "theo_test_contract_key",
        model: { id: "composer-2" },
        local: { cwd: workspace.cwd },
        agents: {
          broken: { description: "Missing prompt" } as never,
        },
      }),
    ).rejects.toMatchObject({
      name: "ConfigurationError",
      message: expect.stringMatching(/prompt|required/i),
    });
  });
});
