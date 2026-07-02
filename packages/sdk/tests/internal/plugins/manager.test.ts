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
    const fac = (_cwd: string) => ({
      id: "lance",
      capabilities: {
        history: false,
        sessions: false,
        tenancy: false,
        reasoning: false,
        toolSchemas: false,
        prefetch: false,
      },
      isAvailable: () => true,
      write: async () =>
        "lance:1" as unknown as import("../../../src/types/memory-adapter.js").MemoryId,
      recall: async () => [],
      delete: async () => {},
    });
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

describe("PluginManager.register — post-init single-plugin registration (#68)", () => {
  it("aggregates a pre_tool_call hook AFTER initialize (veto now wired)", async () => {
    const mgr = new PluginManager();
    await mgr.initialize([]); // manager already initialized, like a live agent
    const plugin: Plugin = {
      name: "acp-permission-s1",
      version: "1.0",
      kind: "general",
      register: (ctx) => {
        ctx.on("pre_tool_call", () => ({ block: true, message: "denied" }));
      },
    };
    await mgr.register(plugin);
    const result = await mgr.runPreToolCallHooks({ name: "x", args: {}, agentId: "a", runId: "r" });
    expect(result?.block).toBe(true);
    expect(result?.message).toBe("denied");
  });

  it("re-registering the same plugin name REPLACES its hooks (no duplicate handler)", async () => {
    const mgr = new PluginManager();
    await mgr.initialize([]);
    let calls = 0;
    const make = (): Plugin => ({
      name: "acp-permission-s1",
      version: "1.0",
      kind: "general",
      register: (ctx) => {
        ctx.on("pre_tool_call", () => {
          calls += 1;
          return undefined;
        });
      },
    });
    await mgr.register(make());
    await mgr.register(make()); // same name → replace, not append
    await mgr.runPreToolCallHooks({ name: "x", args: {}, agentId: "a", runId: "r" });
    expect(calls).toBe(1); // exactly one handler survives (replaced), not two
  });

  it("rejects a non-general plugin registered post-init", async () => {
    const mgr = new PluginManager();
    await mgr.initialize([]);
    const provider: Plugin = {
      name: "prov",
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
    await expect(mgr.register(provider)).rejects.toThrow(/general/i);
  });

  // F-H2 / TQ-01 — integration against the REAL PluginManager (NOT a mock), so
  // the veto is proven on the exact wiring that the ACP install goes through.
  // The original #68 bug was masked by a mock manager that already had register().
  it("veto integration: a deny pre_tool_call plugin registered post-init blocks a tool, an allowed tool passes", async () => {
    const mgr = new PluginManager();
    await mgr.initialize([]); // agent already initialized

    // Exactly what installPermissionPlugin(deny) builds: a general plugin whose
    // pre_tool_call returns {block:true} for a non-trusted tool.
    const denyPlugin: Plugin = {
      name: "acp-permission-session-x",
      version: "1.0.0",
      kind: "general",
      register: (ctx) => {
        ctx.on("pre_tool_call", (raw) => {
          const ev = raw as { name: string };
          if (ev.name === "trusted_tool") return undefined; // allowed
          return { block: true, message: "denied (permissionDefault=deny)" };
        });
      },
    };
    await mgr.register(denyPlugin);

    // A guarded tool is vetoed — the block decision the loop uses to SKIP the
    // handler (tool-dispatch.ts honors {block:true} before runToolWithLifecycle).
    const blocked = await mgr.runPreToolCallHooks({
      name: "shell",
      args: {},
      agentId: "a",
      runId: "r",
    });
    expect(blocked?.block).toBe(true);
    expect(blocked?.message).toMatch(/denied/);

    // A trusted tool is NOT vetoed → the loop proceeds to run it.
    const allowed = await mgr.runPreToolCallHooks({
      name: "trusted_tool",
      args: {},
      agentId: "a",
      runId: "r",
    });
    expect(allowed).toBeUndefined();
  });
});
