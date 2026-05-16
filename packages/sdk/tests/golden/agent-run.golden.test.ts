import { afterEach, describe, expect, it } from "vitest";

import { Agent } from "../../src/index.js";
import { assertGoldenHasContractSignal, normalizeForGolden } from "../helpers/normalize.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";
import cloudAgentInfoGolden from "./agent/cloud-agent-info.json";
import localAgentInfoGolden from "./agent/local-agent-info.json";
import waitCancelledLocalGolden from "./run/wait-cancelled.local.json";
import waitErrorLocalGolden from "./run/wait-error.local.json";
import waitFinishedCloudGolden from "./run/wait-finished.cloud.json";
import waitFinishedLocalGolden from "./run/wait-finished.local.json";

describe("agent and run golden contracts", () => {
  let workspace: TempWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
    workspace = undefined;
  });

  it("matches normalized local agent metadata golden", async () => {
    workspace = await createTempWorkspace("simple-node-project");
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      name: "Contract Local Agent",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd: workspace.cwd },
    });

    const info = await Agent.get(agent.agentId, { cwd: workspace.cwd });
    const normalized = normalizeForGolden(info);

    assertGoldenHasContractSignal(normalized);
    expect(normalized).toEqual(localAgentInfoGolden);
  });

  it("matches normalized cloud agent metadata golden", async () => {
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      name: "Contract Cloud Agent",
      cloud: {
        repos: [{ url: "https://github.com/usetheo/example", startingRef: "main" }],
        autoCreatePR: true,
      },
    });

    const info = await Agent.get(agent.agentId, { apiKey: "theo_test_contract_key" });
    const normalized = normalizeForGolden(info);

    assertGoldenHasContractSignal(normalized);
    expect(normalized).toEqual(cloudAgentInfoGolden);
  });

  it("matches normalized local finished run golden", async () => {
    workspace = await createTempWorkspace("simple-node-project");
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd: workspace.cwd },
    });

    const run = await agent.send("Return only: The answer is 42.");
    const result = await run.wait();
    const normalized = normalizeForGolden(result);

    assertGoldenHasContractSignal(normalized);
    expect(normalized).toEqual(waitFinishedLocalGolden);
  });

  it("matches normalized local cancelled run golden", async () => {
    workspace = await createTempWorkspace("simple-node-project");
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd: workspace.cwd },
    });

    const run = await agent.send("Run npm run slow, then wait for it.");
    await run.cancel();
    const result = await run.wait();
    const normalized = normalizeForGolden(result);

    assertGoldenHasContractSignal(normalized);
    expect(normalized).toEqual(waitCancelledLocalGolden);
  });

  it("matches normalized local error run golden", async () => {
    workspace = await createTempWorkspace("simple-node-project");
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd: workspace.cwd },
    });

    const run = await agent.send("Run npm run fail and report the command failure.");
    const result = await run.wait();
    const normalized = normalizeForGolden(result);

    assertGoldenHasContractSignal(normalized);
    expect(normalized).toEqual(waitErrorLocalGolden);
  });

  it("matches normalized cloud finished run golden with git metadata", async () => {
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "google/gemini-2.0-flash-001" },
      cloud: {
        repos: [{ url: "https://github.com/usetheo/example", startingRef: "main" }],
        autoCreatePR: true,
      },
    });

    const run = await agent.send("Update README.md and open a PR.");
    const result = await run.wait();
    const normalized = normalizeForGolden(result);

    assertGoldenHasContractSignal(normalized);
    expect(normalized).toEqual(waitFinishedCloudGolden);
  });
});
