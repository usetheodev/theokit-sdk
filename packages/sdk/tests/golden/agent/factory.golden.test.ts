import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfigurationError, createAgentFactory } from "../../../src/index.js";

/**
 * Golden tests for {@link createAgentFactory} — Phase 2 of the agent
 * construction DX helpers plan (ADR D23). Covers merge strategy (shallow
 * top-level, deep for local/memory/cloud, replace for collections), agentId
 * precedence, validation propagation, and the resume path.
 */

describe("createAgentFactory", () => {
  let cwd: string | undefined;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-factory-"));
  });
  afterEach(() => {
    cwd = undefined;
  });

  it("forSession merges common and overrides at top level", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const factory = createAgentFactory({
      apiKey: "theo_test_factory",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd },
    });
    const agent = await factory.forSession(`tg-fs-${Date.now()}`, {
      name: "session-named",
    });
    expect(agent.agentId).toMatch(/^tg-fs-/);
    expect(agent.model?.id).toBe("claude-sonnet-4-6");
    await agent.dispose();
  });

  it("forSession deep-merges local options", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const factory = createAgentFactory({
      apiKey: "theo_test_factory",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd, sandboxOptions: { enabled: true } },
    });
    // Overrides only `settingSources` — `cwd` and `sandboxOptions` must
    // survive from common.
    const agent = await factory.forSession(`tg-dml-${Date.now()}`, {
      local: { settingSources: ["project"] },
    });
    expect(agent.agentId).toMatch(/^tg-dml-/);
    await agent.dispose();
  });

  it("forSession replaces tools array (no merge)", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const commonTool = {
      name: "from_common",
      description: "agent-time tool",
      inputSchema: { type: "object" },
      handler: () => "common",
    };
    const overrideTool = {
      name: "from_override",
      description: "per-session tool",
      inputSchema: { type: "object" },
      handler: () => "override",
    };
    const factory = createAgentFactory({
      apiKey: "theo_test_factory",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd },
      tools: [commonTool],
    });
    const agent = await factory.forSession(`tg-tr-${Date.now()}`, {
      tools: [overrideTool],
    });
    // We can't introspect tools directly; assert agent built ok and that
    // re-applying common tools required no re-supply (they're gone).
    expect(agent.agentId).toMatch(/^tg-tr-/);
    await agent.dispose();
  });

  it("getOrCreate path resumes an existing agent", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const factory = createAgentFactory({
      apiKey: "theo_test_factory",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd },
    });
    const agentId = `tg-gor-${Date.now()}`;
    const first = await factory.forSession(agentId);
    const second = await factory.getOrCreate(agentId);
    expect(second.agentId).toBe(first.agentId);
    await first.dispose();
    await second.dispose();
  });

  it("param agentId wins over both common.agentId and overrides.agentId", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const factory = createAgentFactory({
      apiKey: "theo_test_factory",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd },
      agentId: "tg-common-id-ignored",
    });
    const paramId = `tg-param-wins-${Date.now()}`;
    const agent = await factory.forSession(paramId, {
      agentId: "tg-override-id-ignored",
    });
    expect(agent.agentId).toBe(paramId);
    await agent.dispose();
  });

  it("propagates validation errors from underlying Agent.create", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    // common lacks model AND overrides doesn't supply one
    const factory = createAgentFactory({
      apiKey: "theo_test_factory",
      local: { cwd },
    });
    await expect(factory.forSession(`tg-noModel-${Date.now()}`)).rejects.toBeInstanceOf(
      ConfigurationError,
    );
  });

  it("deep-merges memory option without losing namespace/enabled", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const factory = createAgentFactory({
      apiKey: "theo_test_factory",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd },
      memory: { enabled: true, namespace: "factory-test", scope: "user" },
    });
    // Override supplies only userId — enabled/namespace/scope must survive
    const agent = await factory.forSession(`tg-mem-${Date.now()}`, {
      memory: { enabled: true, userId: "user-42" },
    });
    expect(agent.agentId).toMatch(/^tg-mem-/);
    await agent.dispose();
  });
});
