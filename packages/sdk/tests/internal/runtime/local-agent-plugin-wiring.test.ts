/**
 * Tests for Plugin wiring in LocalAgent (T4.1 + T4.2, ADRs D97-D101).
 */

import { describe, expect, it, vi } from "vitest";

import { Agent } from "../../../src/index.js";
import * as guards from "../../../src/internal/plugins/plugin-guards.js";
import { extractCodePlugins, isCodePlugin } from "../../../src/internal/plugins/plugin-guards.js";
import { Plugin } from "../../../src/internal/plugins/types.js";
import { useTempCwd } from "../../helpers/temp-workspace.js";

// Agent.create defaults its workspace to process.cwd(), which during a test run is the
// package itself — this file created agents without saying where, and the state landed in
// packages/sdk/.theokit/. See useTempCwd's docblock for the 540 MB that bought.
useTempCwd();

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
    // B-007. The body constructed an agent and disposed it, asserting nothing — and measured, it is
    // genuinely unprotected: making `extractCodePlugins` return a plugin for `undefined` leaves this
    // test green while the agent silently loads one. `local-agent.ts:210` is where construction
    // decides the code-plugin set, and it decides it by calling this function, so spying it observes
    // the decision at the point it is made — no production change needed.
    const extract = vi.spyOn(guards, "extractCodePlugins");
    try {
      const agent = await Agent.create({ apiKey: FIXTURE_KEY, agentId: uid() });
      expect(extract, "construction must consult the plugin extractor").toHaveBeenCalled();
      expect(
        extract.mock.results[0]?.value,
        "an agent created with no plugins option must load zero code plugins",
      ).toEqual([]);
      await agent.dispose();
    } finally {
      extract.mockRestore();
    }
  });

  it("general plugin register() is called once", async () => {
    let calls = 0;
    const plugin = Plugin.create({
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
