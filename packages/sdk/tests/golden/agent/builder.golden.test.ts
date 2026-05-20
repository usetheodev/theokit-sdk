import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Agent, ConfigurationError } from "../../../src/index.js";

/**
 * Golden tests for {@link Agent.builder} — Phase 4 of the agent construction
 * DX helpers plan (ADR D25). Covers chainable setters, build() shallow clone
 * (EC-2), validation delegation, and create/getOrCreate terminals.
 */

describe("Agent.builder()", () => {
  let cwd: string | undefined;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-builder-"));
  });
  afterEach(() => {
    cwd = undefined;
  });

  it("build() returns AgentOptions populated from chained setters", () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const opts = Agent.builder()
      .model({ id: "claude-sonnet-4-6" })
      .local({ cwd })
      .name("chained-agent")
      .build();
    expect(opts.model?.id).toBe("claude-sonnet-4-6");
    expect(opts.local?.cwd).toBe(cwd);
    expect(opts.name).toBe("chained-agent");
  });

  it("create() calls Agent.create() and returns SDKAgent", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const agent = await Agent.builder()
      .apiKey("theo_test_dx_helpers")
      .model({ id: "claude-sonnet-4-6" })
      .local({ cwd })
      .agentId(`tg-builder-create-${Date.now()}`)
      .create();
    expect(agent.agentId).toMatch(/^tg-builder-create-/);
    await agent.dispose();
  });

  it("getOrCreate(id) routes through Agent.getOrCreate()", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const agentId = `tg-builder-gor-${Date.now()}`;
    const first = await Agent.builder()
      .apiKey("theo_test_dx_helpers")
      .model({ id: "claude-sonnet-4-6" })
      .local({ cwd })
      .getOrCreate(agentId);
    const second = await Agent.builder()
      .apiKey("theo_test_dx_helpers")
      .model({ id: "claude-sonnet-4-6" })
      .local({ cwd })
      .getOrCreate(agentId);
    expect(second.agentId).toBe(first.agentId);
    await first.dispose();
    await second.dispose();
  });

  it("setter called twice replaces (last wins)", () => {
    const t1 = {
      name: "first",
      description: "first tool",
      inputSchema: { type: "object" },
      handler: () => "a",
    };
    const t2 = {
      name: "second",
      description: "second tool",
      inputSchema: { type: "object" },
      handler: () => "b",
    };
    const opts = Agent.builder().tools([t1]).tools([t2]).build();
    expect(opts.tools).toEqual([t2]);
    expect(opts.tools).toHaveLength(1);
  });

  it("propagates validation errors from Agent.create (missing model)", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    await expect(
      Agent.builder().apiKey("theo_test_dx_helpers").local({ cwd }).create(),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });

  it("chainable: each setter returns the same builder instance (this)", () => {
    const b = Agent.builder();
    const b2 = b.model({ id: "claude-sonnet-4-6" });
    expect(b2).toBe(b);
    const b3 = b2.name("x").apiKey("y");
    expect(b3).toBe(b);
  });

  it("build() returns an independent snapshot — EC-2", () => {
    const b = Agent.builder().model({ id: "claude-sonnet-4-6" }).name("first");
    const opts1 = b.build();
    const opts2 = b.build();
    expect(opts1).not.toBe(opts2); // different references
    // Mutate opts1 — builder state stays clean
    opts1.name = "mutated-external";
    const opts3 = b.build();
    expect(opts3.name).toBe("first");
  });
});
