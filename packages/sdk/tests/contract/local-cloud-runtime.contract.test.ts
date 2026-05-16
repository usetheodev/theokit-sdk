import { afterEach, describe, expect, it } from "vitest";

import { Agent, Theokit } from "../../src/index.js";
import waitFinishedCloud from "../golden/run/wait-finished.cloud.json";
import { collectStream } from "../helpers/collect-stream.js";
import { normalizeForGolden } from "../helpers/normalize.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";

describe("local and cloud runtime contract", () => {
  let workspace: TempWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
    workspace = undefined;
  });

  it("local and cloud agent ids, run results, and status events remain distinguishable", async () => {
    workspace = await createTempWorkspace("simple-node-project");
    const localAgent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "google/gemini-2.0-flash-exp:free" },
      local: { cwd: workspace.cwd },
    });
    const cloudAgent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "google/gemini-2.0-flash-exp:free" },
      cloud: { repos: [{ url: "https://github.com/usetheo/example" }], autoCreatePR: true },
    });

    const localRun = await localAgent.send("Summarize local fixture.");
    const cloudRun = await cloudAgent.send("Summarize cloud repo and create PR.");
    const cloudEvents = await collectStream(cloudRun);
    const cloudResult = await cloudRun.wait();

    expect(localAgent.agentId).toMatch(/^agent-/);
    expect(cloudAgent.agentId).toMatch(/^bc-/);
    expect(localRun.agentId).toBe(localAgent.agentId);
    expect(cloudRun.agentId).toBe(cloudAgent.agentId);
    expect(cloudEvents).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "status" })]),
    );
    expect(normalizeForGolden(cloudResult)).toEqual(waitFinishedCloud);
  });

  it("Theokit models and repositories expose catalog contracts", async () => {
    await expect(Theokit.models.list({ apiKey: "theo_test_contract_key" })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.any(String),
          name: expect.any(String),
        }),
      ]),
    );
    await expect(Theokit.repositories.list({ apiKey: "theo_test_contract_key" })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: expect.stringMatching(/^https:\/\/github\.com\//),
        }),
      ]),
    );
  });
});
