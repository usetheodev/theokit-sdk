import { afterEach, describe, expect, it } from "vitest";

import { Agent, type Run } from "../../src/index.js";
import waitCancelledLocal from "../golden/run/wait-cancelled.local.json";
import waitFinishedLocal from "../golden/run/wait-finished.local.json";
import { normalizeForGolden } from "../helpers/normalize.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";

describe("Run lifecycle contract", () => {
  let workspace: TempWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
    workspace = undefined;
  });

  it("agent.send returns a running Run with all public operations", async () => {
    workspace = await createTempWorkspace("simple-node-project");
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd },
    });

    const run = await agent.send("Inspect src/index.js");

    expectRunHandle(run, agent.agentId);
  });

  it("run.wait resolves to the normalized finished RunResult contract", async () => {
    workspace = await createTempWorkspace("simple-node-project");
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd },
    });
    const run = await agent.send("Return only: The answer is 42.");

    const result = await run.wait();

    expect(normalizeForGolden(result)).toEqual(waitFinishedLocal);
  });

  it("run.cancel aborts an in-flight run and wait resolves as cancelled", async () => {
    workspace = await createTempWorkspace("simple-node-project");
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd },
    });
    const run = await agent.send("Run npm run slow, then wait for it.");

    await run.cancel();
    const result = await run.wait();

    expect(run.status).toBe("cancelled");
    expect(normalizeForGolden(result)).toEqual(waitCancelledLocal);
    await expect(run.cancel()).resolves.toBeUndefined();
  });

  it("run.conversation returns public ConversationTurn structures", async () => {
    workspace = await createTempWorkspace("simple-node-project");
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd },
    });
    const run = await agent.send("Inspect the project with shell and summarize.");
    await run.wait();

    const conversation = await run.conversation();

    expect(conversation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "agentConversationTurn",
          turn: expect.objectContaining({
            steps: expect.arrayContaining([
              expect.objectContaining({
                type: expect.stringMatching(/assistantMessage|thinkingMessage|toolCall/),
              }),
            ]),
          }),
        }),
      ]),
    );
  });
});

function expectRunHandle(run: Run, agentId: string): void {
  expect(run).toMatchObject({
    id: expect.stringMatching(/^run-/),
    agentId,
    status: "running",
    stream: expect.any(Function),
    wait: expect.any(Function),
    cancel: expect.any(Function),
    conversation: expect.any(Function),
    supports: expect.any(Function),
    unsupportedReason: expect.any(Function),
    onDidChangeStatus: expect.any(Function),
  });
}
