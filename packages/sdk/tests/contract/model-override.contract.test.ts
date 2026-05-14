import { afterEach, describe, expect, it } from "vitest";

import { Agent } from "../../src/index.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";

describe("per-run model override contract", () => {
  let workspace: TempWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
    workspace = undefined;
  });

  it("uses send override for that run and makes it sticky after success", async () => {
    workspace = await createTempWorkspace("simple-node-project");
    const initialModel = { id: "composer-2" };
    const overrideModel = { id: "composer-2", params: [{ id: "thinking", value: "high" }] };
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: initialModel,
      local: { cwd: workspace.cwd },
    });

    const overriddenRun = await agent.send("Plan the inspection.", { model: overrideModel });
    const firstResult = await overriddenRun.wait();
    const nextRun = await agent.send("Continue without passing a model override.");

    expect(overriddenRun.model).toEqual(overrideModel);
    expect(firstResult.model).toEqual(overrideModel);
    expect(agent.model).toEqual(overrideModel);
    expect(nextRun.model).toEqual(overrideModel);
    expect(overriddenRun.model).toEqual(overrideModel);
  });
});
