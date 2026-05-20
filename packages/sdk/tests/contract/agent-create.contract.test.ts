import { afterEach, describe, expect, it } from "vitest";

import { Agent, type SDKAgent } from "../../src/index.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";

const apiKey = "theo_test_contract_key";
const model = { id: "google/gemini-2.0-flash-001" };
const asyncDisposeSymbol = (Symbol as unknown as { asyncDispose: symbol }).asyncDispose;

describe("Agent.create contract", () => {
  let workspace: TempWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
    workspace = undefined;
  });

  it("creates a complete local SDKAgent handle", async () => {
    workspace = await createTempWorkspace("simple-node-project");

    const agent = await Agent.create({
      apiKey,
      model,
      local: { cwd: workspace.cwd },
    });

    expectCompleteAgent(agent, /^agent-/);
    expect(agent.model).toEqual(model);
  });

  it("rejects local creation without model with ConfigurationError", async () => {
    workspace = await createTempWorkspace("simple-node-project");

    await expect(
      Agent.create({
        apiKey,
        local: { cwd: workspace.cwd },
      }),
    ).rejects.toMatchObject({
      name: "ConfigurationError",
      message: expect.stringMatching(/model/i),
    });
  });

  it("creates a cloud SDKAgent with bc-prefixed id and cloud options", async () => {
    const agent = await Agent.create({
      apiKey,
      cloud: {
        repos: [{ url: "https://github.com/usetheo/example", startingRef: "main" }],
        autoCreatePR: true,
        envVars: { STAGING_TOKEN: "secret-value" },
      },
    });

    expectCompleteAgent(agent, /^bc-/);
    expect(agent.model).toBeUndefined();
  });

  it("rejects cloud env vars that use the reserved THEOKIT_ prefix", async () => {
    await expect(
      Agent.create({
        apiKey,
        model,
        cloud: {
          repos: [{ url: "https://github.com/usetheo/example" }],
          envVars: { THEOKIT_INTERNAL: "must-not-pass" },
        },
      }),
    ).rejects.toMatchObject({
      name: "ConfigurationError",
      message: expect.stringMatching(/THEOKIT_|reserved|env/i),
    });
  });
});

function expectCompleteAgent(agent: SDKAgent, prefix: RegExp): void {
  expect(agent).toMatchObject({
    agentId: expect.stringMatching(prefix),
    send: expect.any(Function),
    reload: expect.any(Function),
    close: expect.any(Function),
    listArtifacts: expect.any(Function),
    downloadArtifact: expect.any(Function),
  });
  expect(Reflect.get(agent, asyncDisposeSymbol)).toEqual(expect.any(Function));
}
