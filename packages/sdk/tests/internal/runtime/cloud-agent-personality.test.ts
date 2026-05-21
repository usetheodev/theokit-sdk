/**
 * T6.1 — CloudAgent.usePersonality rejects with UnsupportedRunOperationError
 * (ADR D169 + D122 pattern).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Agent } from "../../../src/agent.js";
import { UnsupportedRunOperationError } from "../../../src/errors.js";

describe("CloudAgent.usePersonality (T6.1)", () => {
  let prevBaseUrl: string | undefined;
  beforeEach(() => {
    prevBaseUrl = process.env.THEOKIT_API_BASE_URL;
  });
  afterEach(() => {
    if (prevBaseUrl !== undefined) process.env.THEOKIT_API_BASE_URL = prevBaseUrl;
    else delete process.env.THEOKIT_API_BASE_URL;
  });

  it("throws UnsupportedRunOperationError on cloud agents (pre-release)", async () => {
    // Cloud agent is triggered by `options.cloud`.
    const agent = await Agent.create({
      apiKey: "theo_test_cloud",
      model: { id: "openai/gpt-4o-mini" },
      cloud: {},
    });
    await expect(agent.usePersonality?.("anything")).rejects.toBeInstanceOf(
      UnsupportedRunOperationError,
    );
    await agent.dispose();
  });
});
