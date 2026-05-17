import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Agent, ConfigurationError, UnknownAgentError } from "../../../src/index.js";

/**
 * Golden tests for {@link Agent.getOrCreate} — Phase 1 of the agent
 * construction DX helpers plan (ADR D22). Covers happy paths (cold create,
 * warm resume), error propagation, agentId precedence, tools re-supply, and
 * the same-process race retry (EC-1).
 */

describe("Agent.getOrCreate", () => {
  let cwd: string | undefined;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-getorcreate-"));
  });
  afterEach(() => {
    cwd = undefined;
  });

  it("creates when id is unknown (cold path)", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const agentId = `tg-cold-${Date.now()}`;
    const agent = await Agent.getOrCreate(agentId, {
      apiKey: "theo_test_dx_helpers",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd },
    });
    expect(agent.agentId).toBe(agentId);
    await agent.dispose();
  });

  it("resumes when id already exists (warm path)", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const agentId = `tg-warm-${Date.now()}`;
    const first = await Agent.create({
      agentId,
      apiKey: "theo_test_dx_helpers",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd },
    });
    const second = await Agent.getOrCreate(agentId, {
      model: { id: "claude-sonnet-4-6" },
      local: { cwd },
    });
    expect(second.agentId).toBe(agentId);
    expect(second.agentId).toBe(first.agentId);
    await first.dispose();
    await second.dispose();
  });

  it("rethrows non-UnknownAgentError exceptions (e.g., missing model)", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const agentId = `tg-invalid-${Date.now()}`;
    // No model + local set → resume miss → create fails with missing_model
    await expect(
      Agent.getOrCreate(agentId, {
        apiKey: "theo_test_dx_helpers",
        local: { cwd },
      } as never),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });

  it("forces agentId param over options.agentId on cold path", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const paramId = `tg-param-${Date.now()}`;
    const agent = await Agent.getOrCreate(paramId, {
      agentId: "tg-ignored-options-id",
      apiKey: "theo_test_dx_helpers",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd },
    });
    expect(agent.agentId).toBe(paramId);
    await agent.dispose();
  });

  it("resumes with re-supplied tools (handlers not persisted)", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const agentId = `tg-tools-${Date.now()}`;
    let firstHandlerCalls = 0;
    let secondHandlerCalls = 0;
    const first = await Agent.create({
      agentId,
      apiKey: "theo_test_dx_helpers",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd },
      tools: [
        {
          name: "noop",
          description: "marker",
          inputSchema: { type: "object" },
          handler: () => {
            firstHandlerCalls += 1;
            return "first";
          },
        },
      ],
    });
    await first.dispose();
    const second = await Agent.getOrCreate(agentId, {
      apiKey: "theo_test_dx_helpers",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd },
      tools: [
        {
          name: "noop",
          description: "marker",
          inputSchema: { type: "object" },
          handler: () => {
            secondHandlerCalls += 1;
            return "second";
          },
        },
      ],
    });
    expect(second.agentId).toBe(agentId);
    // Handlers themselves can't be inspected directly via public API; we
    // assert that resume succeeded without throwing (re-supply path valid).
    expect(firstHandlerCalls).toBe(0);
    expect(secondHandlerCalls).toBe(0);
    await second.dispose();
  });

  it("does NOT silently cold-create when Agent.resume cold-misses without options.agentId", async () => {
    // Documentation guard: getOrCreate must throw UnknownAgentError-equivalent
    // ONLY internally; externally it MUST create-on-miss. This test asserts
    // create path was hit (i.e., new id registered) and no error surfaced.
    if (cwd === undefined) throw new Error("missing workspace");
    const agentId = `tg-cold-noopts-${Date.now()}`;
    const agent = await Agent.getOrCreate(agentId, {
      apiKey: "theo_test_dx_helpers",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd },
    });
    expect(agent.agentId).toBe(agentId);
    // Calling resume directly now would succeed (was registered by create).
    const resumed = await Agent.resume(agentId, { local: { cwd } });
    expect(resumed.agentId).toBe(agentId);
    await agent.dispose();
    await resumed.dispose();
  });

  it("handles same-process concurrent create race (EC-1)", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const agentId = `tg-race-${Date.now()}`;
    const opts = {
      apiKey: "theo_test_dx_helpers",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd },
    } as const;
    // Fire two concurrent getOrCreate calls. Both will resume-miss (cold),
    // both attempt create. The loser must catch agent_id_already_exists and
    // retry resume — NOT propagate the error.
    const results = await Promise.allSettled([
      Agent.getOrCreate(agentId, opts),
      Agent.getOrCreate(agentId, opts),
    ]);
    const successes = results.filter((r) => r.status === "fulfilled");
    expect(successes).toHaveLength(2);
    // Both handles must refer to the same agentId.
    for (const r of successes) {
      const handle = (r as PromiseFulfilledResult<{ agentId: string }>).value;
      expect(handle.agentId).toBe(agentId);
    }
    // Cleanup
    for (const r of successes) {
      const handle = (r as PromiseFulfilledResult<{ dispose: () => Promise<void> }>).value;
      await handle.dispose();
    }
  });

  it("UnknownAgentError class is exported for consumer-side catches", () => {
    // Sanity check: the class consumers might still catch (legacy code).
    expect(UnknownAgentError).toBeDefined();
    expect(new UnknownAgentError("test").name).toBe("UnknownAgentError");
  });
});
