import { afterEach, describe, expect, it } from "vitest";

import { Agent, type AgentOptions } from "../../src/index.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";

describe("memory contract", () => {
  let workspace: TempWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
    workspace = undefined;
  });

  it("persists durable facts across agent instances for the same memory namespace and user", async () => {
    workspace = await createTempWorkspace("simple-node-project");
    const baseOptions = {
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd },
      memory: {
        enabled: true,
        namespace: "sdk-contract",
        userId: "user-a",
        scope: "user",
      },
    } satisfies ProposedAgentOptions;

    const first = await Agent.create(baseOptions);
    const rememberRun = await first.send(
      "Remember this durable preference: preferred test runner is Vitest.",
    );
    await expect(rememberRun.wait()).resolves.toMatchObject({ status: "finished" });
    await first.dispose();

    const second = await Agent.create(baseOptions);
    const recallRun = await second.send("What is my preferred test runner?");
    const result = await recallRun.wait();

    expect(result).toMatchObject({
      status: "finished",
      result: expect.stringMatching(/Vitest/i),
    });
  });

  it("isolates memories by userId and does not leak secrets into memory recall", async () => {
    workspace = await createTempWorkspace("simple-node-project");
    const userAOptions: ProposedAgentOptions = {
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd },
      memory: { enabled: true, namespace: "sdk-contract", userId: "user-a", scope: "user" },
    };
    const userA = await Agent.create(userAOptions);
    await (
      await userA.send(
        "Remember: my deploy token is sk-proj-memory-secret-1234567890 and my editor is Neovim.",
      )
    ).wait();
    await userA.dispose();

    const userBOptions: ProposedAgentOptions = {
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd },
      memory: { enabled: true, namespace: "sdk-contract", userId: "user-b", scope: "user" },
    };
    const userB = await Agent.create(userBOptions);
    const result = await (
      await userB.send("What editor and token did user-a ask you to remember?")
    ).wait();

    expect(result.result ?? "").not.toContain("Neovim");
    expect(result.result ?? "").not.toContain("sk-proj-memory-secret");
    expect(result.result ?? "").not.toContain("1234567890");
  });

  it("rejects memory store paths outside the workspace", async () => {
    workspace = await createTempWorkspace("simple-node-project");

    await expect(
      Agent.create({
        apiKey: "theo_test_contract_key",
        model: { id: "composer-2" },
        local: { cwd: workspace.cwd },
        memory: {
          enabled: true,
          namespace: "bad",
          userId: "user-a",
          storePath: "../outside-memory.json",
        },
      } as ProposedAgentOptions),
    ).rejects.toMatchObject({
      name: "ConfigurationError",
      message: expect.stringMatching(/memory|path|workspace/i),
    });
  });
});

type ProposedAgentOptions = AgentOptions & {
  memory?: {
    enabled: boolean;
    namespace?: string;
    userId?: string;
    scope?: "agent" | "user" | "team";
    storePath?: string;
  };
};
