/**
 * E2E: error propagation from the public Agent facade.
 *
 * Re-expressed from the removed TheoKitContainer-based test (arch-review
 * Group C). The container faked an "AgentDisposedError" via a string; this
 * exercises the REAL `AgentDisposedError` thrown by `local-agent-send.ts`
 * when a disposed agent is used — genuine coverage the container test lacked.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Agent } from "../../src/agent.js";
import { AgentDisposedError } from "../../src/errors.js";

const FIXTURE_KEY = "theo_test_error_propagation";
const MODEL = { id: "openai/gpt-4o-mini" };

describe("E2E: error propagation", () => {
  let cwd: string;

  beforeEach(async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    cwd = await mkdtemp(join(tmpdir(), "theokit-errprop-"));
  });

  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(cwd, { recursive: true, force: true });
  });

  it("send after dispose rejects with AgentDisposedError", async () => {
    const agent = await Agent.create({
      agentId: "agent-errprop-disposed",
      apiKey: FIXTURE_KEY,
      model: MODEL,
      local: { cwd },
    });
    await agent.dispose();

    await expect(agent.send("hello")).rejects.toBeInstanceOf(AgentDisposedError);
  });

  it("AgentDisposedError carries the agentId and a non-retryable code", async () => {
    const agent = await Agent.create({
      agentId: "agent-errprop-meta",
      apiKey: FIXTURE_KEY,
      model: MODEL,
      local: { cwd },
    });
    await agent.dispose();

    const err = await agent.send("hi").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgentDisposedError);
    expect((err as AgentDisposedError).agentId).toBe("agent-errprop-meta");
    expect((err as AgentDisposedError).code).toBe("agent_disposed");
    expect((err as AgentDisposedError).isRetryable).toBe(false);
  });
});
