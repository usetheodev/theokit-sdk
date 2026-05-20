/**
 * Tests for PluginManager (T1.3, ADRs D98 + D101).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PluginManager } from "../../../src/internal/plugins/manager.js";
import type { Plugin } from "../../../src/internal/plugins/types.js";

const stderrSpy = vi.spyOn(process.stderr, "write");

beforeEach(() => {
  stderrSpy.mockClear();
});
afterEach(() => {
  // nothing
});

describe("PluginManager (T1.3)", () => {
  it("initialize can be called once", async () => {
    const mgr = new PluginManager();
    await mgr.initialize([]);
    await expect(mgr.initialize([])).rejects.toThrow(/initialize called twice/);
  });

  it("calls register() once per general plugin", async () => {
    const spy = vi.fn();
    const plugin: Plugin = { name: "p", version: "1.0", kind: "general", register: spy };
    const mgr = new PluginManager();
    await mgr.initialize([plugin]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("aggregates tools across plugins", async () => {
    const p1: Plugin = {
      name: "p1",
      version: "1.0",
      kind: "general",
      register: (ctx) => {
        ctx.registerTool({
          name: "ta",
          description: "",
          // biome-ignore lint/suspicious/noExplicitAny: test-only
          inputSchema: {} as any,
          handler: () => "",
        });
      },
    };
    const p2: Plugin = {
      name: "p2",
      version: "1.0",
      kind: "general",
      register: (ctx) => {
        ctx.registerTool({
          name: "tb",
          description: "",
          // biome-ignore lint/suspicious/noExplicitAny: test-only
          inputSchema: {} as any,
          handler: () => "",
        });
      },
    };
    const mgr = new PluginManager();
    await mgr.initialize([p1, p2]);
    expect(mgr.aggregated.tools).toHaveLength(2);
    expect(mgr.aggregated.tools.map((t) => t.name).sort()).toEqual(["ta", "tb"]);
  });

  it("aggregates hooks in plugin registration order", async () => {
    const order: string[] = [];
    const plugins: Plugin[] = [
      {
        name: "first",
        version: "1.0",
        kind: "general",
        register: (ctx) => {
          ctx.on("pre_tool_call", () => {
            order.push("first");
            return undefined;
          });
        },
      },
      {
        name: "second",
        version: "1.0",
        kind: "general",
        register: (ctx) => {
          ctx.on("pre_tool_call", () => {
            order.push("second");
            return undefined;
          });
        },
      },
    ];
    const mgr = new PluginManager();
    await mgr.initialize(plugins);
    await mgr.runPreToolCallHooks({ name: "x", args: {}, agentId: "a", runId: "r" });
    expect(order).toEqual(["first", "second"]);
  });

  it("model-provider plugin collects profile only (no register call)", async () => {
    const plugin: Plugin = {
      name: "anthropic-plugin",
      version: "1.0",
      kind: "model-provider",
      profile: {
        name: "anthropic",
        apiMode: "anthropic_messages",
        envVars: ["ANTHROPIC_API_KEY"],
        authType: "api_key",
        baseUrl: "https://api.anthropic.com",
        fallbackModels: ["claude-opus-4-7"],
      },
    };
    const mgr = new PluginManager();
    await mgr.initialize([plugin]);
    expect(mgr.aggregated.providerProfiles).toHaveLength(1);
    expect(mgr.aggregated.providerProfiles[0]?.profile.name).toBe("anthropic");
  });

  it("memory plugin collects factory", async () => {
    const fac = (_cwd: string) => ({});
    const plugin: Plugin = {
      name: "lance",
      version: "1.0",
      kind: "memory",
      createProvider: fac,
    };
    const mgr = new PluginManager();
    await mgr.initialize([plugin]);
    expect(mgr.aggregated.memoryProviders[0]?.createProvider).toBe(fac);
  });

  it("zero plugins works", async () => {
    const mgr = new PluginManager();
    await mgr.initialize([]);
    expect(mgr.aggregated.tools).toHaveLength(0);
  });

  it("propagates register() throw", async () => {
    const plugin: Plugin = {
      name: "broken",
      version: "1.0",
      kind: "general",
      register: () => {
        throw new Error("boom");
      },
    };
    const mgr = new PluginManager();
    await expect(mgr.initialize([plugin])).rejects.toThrow(/boom/);
  });

  it("pre_tool_call first block wins", async () => {
    const plugins: Plugin[] = [
      {
        name: "p1",
        version: "1.0",
        kind: "general",
        register: (ctx) => {
          ctx.on("pre_tool_call", () => undefined);
        },
      },
      {
        name: "p2",
        version: "1.0",
        kind: "general",
        register: (ctx) => {
          ctx.on("pre_tool_call", () => ({ block: true, message: "stop" }));
        },
      },
      {
        name: "p3",
        version: "1.0",
        kind: "general",
        register: (ctx) => {
          ctx.on("pre_tool_call", () => ({ block: true, message: "never reached" }));
        },
      },
    ];
    const mgr = new PluginManager();
    await mgr.initialize(plugins);
    const result = await mgr.runPreToolCallHooks({ name: "x", args: {}, agentId: "a", runId: "r" });
    expect(result?.message).toBe("stop");
  });

  it("pre_tool_call no handlers returns undefined", async () => {
    const mgr = new PluginManager();
    await mgr.initialize([]);
    const result = await mgr.runPreToolCallHooks({ name: "x", args: {}, agentId: "a", runId: "r" });
    expect(result).toBeUndefined();
  });

  it("EC-4: duplicate plugin name surfaces stderr warn", async () => {
    const make = (name: string): Plugin => ({
      name,
      version: "1.0",
      kind: "general",
      register: () => {},
    });
    const mgr = new PluginManager();
    await mgr.initialize([make("dup"), make("dup")]);
    const calls = stderrSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(calls).toContain("duplicate plugin name");
    expect(calls).toContain("dup");
  });
});
