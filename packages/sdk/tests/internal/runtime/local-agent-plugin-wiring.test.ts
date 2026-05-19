/**
 * Tests for Plugin wiring in LocalAgent (T4.1 + T4.2, ADRs D97-D101).
 */

import { describe, expect, it } from "vitest";

import { Agent } from "../../../src/index.js";
import { definePlugin, type Plugin } from "../../../src/internal/plugins/types.js";
import {
  extractCodePlugins,
  isCodePlugin,
} from "../../../src/internal/runtime/local-agent-plugins.js";

const FIXTURE_KEY = "theo_test_fixture_plugin_wiring";

function uid(): string {
  return `plugin-wire-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("isCodePlugin (T4.1, EC-1)", () => {
  it("returns true for general plugin with register", () => {
    expect(isCodePlugin({ name: "p", version: "1.0", kind: "general", register: () => {} })).toBe(
      true,
    );
  });

  it("returns true for model-provider with profile", () => {
    expect(
      isCodePlugin({
        name: "p",
        version: "1.0",
        kind: "model-provider",
        profile: { name: "x" },
      }),
    ).toBe(true);
  });

  it("returns false for legacy metadata { enabled: [] }", () => {
    expect(isCodePlugin({ enabled: ["openrouter"] })).toBe(false);
  });

  it("returns false for non-object", () => {
    expect(isCodePlugin(null)).toBe(false);
    expect(isCodePlugin("p")).toBe(false);
    expect(isCodePlugin(42)).toBe(false);
  });

  it("returns false for kind without required field", () => {
    expect(isCodePlugin({ name: "p", version: "1.0", kind: "general" })).toBe(false);
    expect(isCodePlugin({ name: "p", version: "1.0", kind: "model-provider" })).toBe(false);
  });
});

describe("extractCodePlugins (T4.1, EC-1)", () => {
  it("returns empty for legacy object shape", () => {
    expect(extractCodePlugins({ enabled: ["openrouter"] })).toEqual([]);
  });

  it("returns empty for undefined/null", () => {
    expect(extractCodePlugins(undefined)).toEqual([]);
    expect(extractCodePlugins(null)).toEqual([]);
  });

  it("filters mixed array — keeps only valid code plugins", () => {
    const valid: Plugin = { name: "ok", version: "1.0", kind: "general", register: () => {} };
    // biome-ignore lint/suspicious/noExplicitAny: test mixed array
    const out = extractCodePlugins([valid, { not: "a plugin" }, null, 42] as any);
    expect(out).toEqual([valid]);
  });
});

describe("Agent.create plugin wiring (T4.1)", () => {
  it("legacy { enabled } shape compiles and runs", async () => {
    const agent = await Agent.create({
      apiKey: FIXTURE_KEY,
      agentId: uid(),
      // biome-ignore lint/suspicious/noExplicitAny: legacy shape preserved for v1.2 callers
      plugins: { enabled: ["openrouter"] } as any,
    });
    expect(agent.agentId).toBeDefined();
    await agent.dispose();
  });

  it("zero plugins works", async () => {
    const agent = await Agent.create({ apiKey: FIXTURE_KEY, agentId: uid() });
    await agent.dispose();
  });

  it("general plugin register() is called once", async () => {
    let calls = 0;
    const plugin = definePlugin({
      name: "test-plugin",
      version: "1.0.0",
      kind: "general",
      register: () => {
        calls++;
      },
    });
    const agent = await Agent.create({
      apiKey: FIXTURE_KEY,
      agentId: uid(),
      // biome-ignore lint/suspicious/noExplicitAny: passing Plugin[] (new shape)
      plugins: [plugin] as any,
    });
    expect(calls).toBe(1);
    await agent.dispose();
  });
});
