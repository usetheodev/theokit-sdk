import { afterEach, describe, expect, it } from "vitest";

import { Agent } from "../../src/index.js";
import assistantTextGolden from "./stream/assistant-text.local.json";
import cloudStatusLifecycleGolden from "./stream/cloud-status-lifecycle.json";
import systemInitGolden from "./stream/system-init.local.json";
import toolCallEnvelopeGolden from "./stream/tool-call-envelope.local.json";
import { collectStream } from "../helpers/collect-stream.js";
import { assertGoldenHasContractSignal, normalizeForGolden } from "../helpers/normalize.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";

describe("stream event golden contracts", () => {
  let workspace: TempWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
    workspace = undefined;
  });

  it("matches normalized local system, assistant, and tool_call event goldens", async () => {
    workspace = await createTempWorkspace("simple-node-project");
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd },
    });
    const run = await agent.send("Use shell to inspect src/index.js, then answer: The answer is 42.");

    const events = await collectStream(run);
    const normalizedEvents = normalizeForGolden(events);

    assertGoldenHasContractSignal(normalizedEvents);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["system", "user", "assistant", "thinking", "tool_call", "task", "request"]),
    );
    expect(normalizeForGolden(events.find((event) => event.type === "system"))).toEqual(systemInitGolden);
    expect(normalizeForGolden(events.find((event) => event.type === "assistant"))).toEqual(assistantTextGolden);
    expect(normalizeForGolden(events.find((event) => event.type === "tool_call"))).toEqual(toolCallEnvelopeGolden);
  });

  it("matches normalized cloud status lifecycle golden", async () => {
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      cloud: {
        repos: [{ url: "https://github.com/usetheo/example", startingRef: "main" }],
        autoCreatePR: true,
      },
    });
    const run = await agent.send("Open a README update PR.");

    const events = await collectStream(run);
    const statuses = events.filter((event) => event.type === "status");
    const normalized = normalizeForGolden(statuses);

    assertGoldenHasContractSignal(normalized);
    expect(normalized).toEqual(cloudStatusLifecycleGolden);
  });
});
