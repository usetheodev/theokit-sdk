import { afterEach, describe, expect, it } from "vitest";

import { Agent, UnsupportedRunOperationError } from "../../src/index.js";
import waitErrorLocal from "../golden/run/wait-error.local.json";
import { normalizeForGolden } from "../helpers/normalize.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";

describe("Run status and operation support contract", () => {
  let workspace: TempWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
    workspace = undefined;
  });

  it("notifies status changes and stops after unsubscribe", async () => {
    workspace = await createTempWorkspace("simple-node-project");
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd },
    });
    const run = await agent.send("Finish quickly.");
    const statuses: string[] = [];

    const unsubscribe = run.onDidChangeStatus((status) => statuses.push(status));
    await run.wait();
    unsubscribe();
    await run.cancel();

    expect(statuses).toEqual(expect.arrayContaining(["running", "finished"]));
    expect(statuses.at(-1)).toBe("finished");
  });

  it("reports supported operations and public unsupported reasons", async () => {
    workspace = await createTempWorkspace("simple-node-project");
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd },
    });
    const run = await agent.send("Check operation capabilities.");

    expect(run.supports("stream")).toBe(true);
    expect(run.supports("wait")).toBe(true);
    expect(run.supports("cancel")).toBe(true);
    expect(run.supports("conversation")).toBe(true);
    expect(run.unsupportedReason("stream")).toBeUndefined();

    const cloudHistoricalRun = await Agent.getRun("run-00000000-0000-4000-8000-000000000002", {
      runtime: "cloud",
      agentId: "bc-00000000-0000-4000-8000-000000000001",
      apiKey: "theo_test_contract_key",
    });

    expect(cloudHistoricalRun.supports("stream")).toBe(false);
    expect(cloudHistoricalRun.unsupportedReason("stream")).toMatch(/historical|not available/i);
    await expect(collectUnsupportedStream(cloudHistoricalRun)).rejects.toBeInstanceOf(
      UnsupportedRunOperationError,
    );
  });

  it("wait resolves error status with stable RunResult shape", async () => {
    workspace = await createTempWorkspace("simple-node-project");
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd },
    });
    const run = await agent.send("Run node src/failing-tool.js and report the failure.");

    const result = await run.wait();

    expect(normalizeForGolden(result)).toEqual(waitErrorLocal);
  });
});

async function collectUnsupportedStream(run: {
  stream(): AsyncGenerator<unknown, void>;
}): Promise<void> {
  for await (const _event of run.stream()) {
    throw new Error("unsupported stream unexpectedly emitted an event");
  }
}
