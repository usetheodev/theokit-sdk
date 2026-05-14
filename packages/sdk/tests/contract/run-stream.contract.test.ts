import { afterEach, describe, expect, it } from "vitest";

import { Agent } from "../../src/index.js";
import assistantGolden from "../golden/stream/assistant-text.local.json";
import cloudStatusGolden from "../golden/stream/cloud-status-lifecycle.json";
import systemGolden from "../golden/stream/system-init.local.json";
import toolCallGolden from "../golden/stream/tool-call-envelope.local.json";
import { collectStream } from "../helpers/collect-stream.js";
import { assertGoldenHasContractSignal, normalizeForGolden } from "../helpers/normalize.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";

describe("run.stream SDKMessage contract", () => {
  let workspace: TempWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
    workspace = undefined;
  });

  it("emits local system, user, assistant, thinking, tool_call, task, and request event shapes", async () => {
    workspace = await createTempWorkspace("simple-node-project");
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd },
    });
    const run = await agent.send("Use shell to inspect src/index.js, then ask for approval before editing.");

    const events = await collectStream(run);
    const normalized = normalizeForGolden(events);
    assertGoldenHasContractSignal(normalized);

    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["system", "user", "assistant", "thinking", "tool_call", "task", "request"]),
    );
    expect(normalizeForGolden(events.find((event) => event.type === "system"))).toEqual(systemGolden);
    expect(normalizeForGolden(events.find((event) => event.type === "assistant"))).toEqual(assistantGolden);
    expect(normalizeForGolden(events.find((event) => event.type === "tool_call"))).toEqual(toolCallGolden);
    expect(events.find((event) => event.type === "user")).toMatchObject({
      type: "user",
      message: {
        role: "user",
        content: expect.arrayContaining([expect.objectContaining({ type: "text" })]),
      },
    });
  });

  it("emits cloud status lifecycle events with bc agent id", async () => {
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      cloud: { repos: [{ url: "https://github.com/usetheo/example" }], autoCreatePR: true },
    });
    const run = await agent.send("Open a PR that updates README.md");

    const events = await collectStream(run);
    const statuses = events.filter((event) => event.type === "status");

    expect(normalizeForGolden(statuses)).toEqual(cloudStatusGolden);
  });
});
