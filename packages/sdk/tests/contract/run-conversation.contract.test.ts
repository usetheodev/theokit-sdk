import { afterEach, describe, expect, it } from "vitest";

import { Agent } from "../../src/index.js";
import { normalizeForGolden } from "../helpers/normalize.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";

describe("run.conversation contract", () => {
  let workspace: TempWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
    workspace = undefined;
  });

  it("returns structured agent and shell turns without freezing deep tool internals", async () => {
    workspace = await createTempWorkspace("simple-node-project");
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd },
    });
    const run = await agent.send("Run ls and explain src/index.js.");
    await run.wait();

    const conversation = await run.conversation();
    const normalized = normalizeForGolden(conversation);

    expect(normalized).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "agentConversationTurn",
          turn: expect.objectContaining({
            steps: expect.arrayContaining([
              expect.objectContaining({ type: "assistantMessage" }),
              expect.objectContaining({ type: "toolCall" }),
            ]),
          }),
        }),
        expect.objectContaining({
          type: "shellConversationTurn",
          turn: expect.objectContaining({
            shellCommand: expect.objectContaining({ command: expect.any(String) }),
            shellOutput: expect.objectContaining({
              stdout: expect.any(String),
              stderr: expect.any(String),
              exitCode: expect.any(Number),
            }),
          }),
        }),
      ]),
    );
    expect(JSON.stringify(normalized)).not.toContain("theo_test_contract_key");
  });
});
