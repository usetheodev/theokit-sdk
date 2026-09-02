import { afterEach, describe, expect, it } from "vitest";

import { Agent, Theokit } from "../../src/index.js";
import waitFinishedCloud from "../golden/run/wait-finished.cloud.json";
import { collectStream } from "../helpers/collect-stream.js";
import { normalizeForGolden } from "../helpers/normalize.js";
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
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd: workspace.cwd },
    });
    const cloudAgent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "google/gemini-2.0-flash-001" },
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

    // Dispose flushes the fire-and-forget session appends before `afterEach`
    // removes the temp workspace — otherwise `rm(recursive)` races an in-flight
    // append into `.theokit/agents/<id>/` and fails `ENOTEMPTY`.
    await localAgent.dispose();
    await cloudAgent.dispose();
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
