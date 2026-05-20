/**
 * T1.2 — Plugin aggregation wiring for typed MemoryAdapter (ADR D141).
 *
 * Verifies the existing plugin manager surfaces a typed `MemoryAdapter`
 * (vs the old `unknown` shape). EC-F: factory rejection is observable
 * by callers and does not corrupt the manager's internal state.
 */

import { describe, expect, it } from "vitest";
import { PluginManager } from "../../../src/internal/plugins/manager.js";
import { definePlugin } from "../../../src/internal/plugins/types.js";
import { mkMemoryId } from "../../../src/memory-adapter-helpers.js";
import type { MemoryAdapter, MemoryId } from "../../../src/types/memory-adapter.js";

function makeAdapter(id: string): MemoryAdapter {
  return {
    id,
    capabilities: {
      history: false,
      sessions: false,
      tenancy: false,
      reasoning: false,
      toolSchemas: false,
      prefetch: false,
    },
    isAvailable: () => true,
    write: async (): Promise<MemoryId> => mkMemoryId(id, "x"),
    recall: async () => [],
    delete: async () => {},
  };
}

describe("Memory plugin aggregation (T1.2)", () => {
  it("aggregates a single memory plugin into memoryProviders array", async () => {
    const plugin = definePlugin({
      name: "test-mem",
      version: "1.0.0",
      kind: "memory",
      createProvider: () => makeAdapter("test-mem"),
    });
    const mgr = new PluginManager();
    await mgr.initialize([plugin]);
    expect(mgr.aggregated.memoryProviders.length).toBe(1);
    expect(mgr.aggregated.memoryProviders[0]?.pluginName).toBe("test-mem");
  });

  it("memory plugin factory returns typed adapter at call time", async () => {
    const plugin = definePlugin({
      name: "typed",
      version: "1.0.0",
      kind: "memory",
      createProvider: () => makeAdapter("typed"),
    });
    const mgr = new PluginManager();
    await mgr.initialize([plugin]);
    const entry = mgr.aggregated.memoryProviders[0];
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    const adapter = await entry.createProvider("/tmp");
    expect(adapter.id).toBe("typed");
    expect(typeof adapter.write).toBe("function");
    expect(typeof adapter.recall).toBe("function");
  });

  it("async factory resolves through aggregated entry", async () => {
    const plugin = definePlugin({
      name: "async",
      version: "1.0.0",
      kind: "memory",
      createProvider: async () => makeAdapter("async"),
    });
    const mgr = new PluginManager();
    await mgr.initialize([plugin]);
    const entry = mgr.aggregated.memoryProviders[0];
    if (entry === undefined) throw new Error("missing entry");
    const adapter = await entry.createProvider("/tmp");
    expect(adapter.id).toBe("async");
  });

  it("factory promise rejection surfaces to caller; does not crash boot (EC-F)", async () => {
    const plugin = definePlugin({
      name: "rejects",
      version: "1.0.0",
      kind: "memory",
      createProvider: async () => {
        throw new Error("network down");
      },
    });
    const mgr = new PluginManager();
    // initialize() itself must NOT call createProvider — only aggregate it.
    await expect(mgr.initialize([plugin])).resolves.toBeUndefined();
    expect(mgr.aggregated.memoryProviders.length).toBe(1);
    // The rejection is observable when the caller actually invokes the factory.
    const entry = mgr.aggregated.memoryProviders[0];
    if (entry === undefined) throw new Error("missing entry");
    await expect(entry.createProvider("/tmp")).rejects.toThrow("network down");
  });
});
