import { afterEach, describe, expect, it } from "vitest";

import { Agent } from "../../src/index.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";

describe("Agent.prompt contract", () => {
  let workspace: TempWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
    workspace = undefined;
  });

  it("creates, sends, waits, and disposes a one-shot local agent", async () => {
    workspace = await createTempWorkspace("simple-node-project");

    const result = await Agent.prompt("Read src/index.js and report the exported answer.", {
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd },
    });

    expect(result).toMatchObject({
      id: expect.stringMatching(/^run-/),
      status: "finished",
      result: expect.stringMatching(/42/),
      model: { id: "composer-2" },
      durationMs: expect.any(Number),
    });
  });

  it("propagates public errors instead of generic Error", async () => {
    workspace = await createTempWorkspace("simple-node-project");

    await expect(
      Agent.prompt("This must fail with public auth error", {
        apiKey: "invalid",
        model: { id: "composer-2" },
        local: { cwd: workspace.cwd },
      }),
    ).rejects.toMatchObject({
      name: "AuthenticationError",
      isRetryable: false,
      code: expect.any(String),
    });
  });
});
