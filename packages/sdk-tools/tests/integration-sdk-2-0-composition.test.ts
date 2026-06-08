/**
 * Cross-package composition smoke test (SDK 2.0 split — Phases 3+4+5 integration).
 *
 * Validates that the three extracted packages (`@theokit/sdk-cache`,
 * `@theokit/sdk-tools`, `@theokit/sdk-handoff`) compose with the kernel
 * (`@theokit/sdk`) WITHOUT runtime conflicts and WITHOUT requiring
 * `@theokit/sdk-budget` / `@theokit/sdk-memory` to exist yet (those are
 * pending Phases 2 / 1).
 *
 * Lives in `@theokit/sdk-tools` because:
 *   - sdk-tools is already a leaf (no upstream sdk-* deps).
 *   - Adding sdk-cache + sdk-handoff as workspace devDeps here is the least
 *     invasive way to test cross-package wiring without inventing a new
 *     integration-tests package.
 *
 * No real LLM call — the test verifies that:
 *   1. Each extracted package can be imported standalone (no runtime errors).
 *   2. Plugin objects from sdk-cache + sdk-handoff are valid `Plugin` shapes
 *      that @theokit/sdk's `definePlugin` accepts as input.
 *   3. Tools from sdk-tools satisfy the `CustomTool` contract.
 *   4. All three integrate into a single mock-shaped agent options object
 *      (Agent.create is NOT invoked — we test pure composition).
 */

import { definePlugin } from "@theokit/sdk";
import { Cache } from "@theokit/sdk-cache";
import { Handoff } from "@theokit/sdk-handoff";
import { describe, expect, it } from "vitest";

import { createListDirTool, createReadFileTool } from "../src/index.js";

const fakeEmbedder = {
  id: "fake",
  model: "fake-1",
  dimension: 4,
  embed: async (texts: ReadonlyArray<string>) => texts.map(() => [0.1, 0.2, 0.3, 0.4]),
};

describe("SDK 2.0 cross-package composition (Phases 3+4+5)", () => {
  it("test_composition_imports_resolve — all 3 extracted packages import without error", () => {
    expect(typeof Cache.semantic).toBe("function");
    expect(typeof Cache.semantic).toBe("function");
    expect(typeof Handoff.create).toBe("function");
    expect(typeof Handoff.asPlugin).toBe("function");
    expect(typeof createReadFileTool).toBe("function");
    expect(typeof createListDirTool).toBe("function");
    expect(typeof definePlugin).toBe("function");
  });

  it("test_composition_cache_as_plugin_shape — Cache.asPlugin() returns a valid Plugin", () => {
    const cache = Cache.semantic({ embedder: fakeEmbedder });
    const plugin = cache.asPlugin();
    expect(plugin).toBeDefined();
    expect(typeof plugin.name).toBe("string");
    expect(plugin.name).toMatch(/^cache-/);
    // `register` lives on the "general" kind branch of the Plugin discriminated
    // union — narrow before access.
    expect("register" in plugin).toBe(true);
    if ("register" in plugin) {
      expect(typeof plugin.register).toBe("function");
    }
  });

  it("test_composition_handoff_as_plugin_shape — Handoff.asPlugin() returns a valid Plugin", () => {
    const plugin = Handoff.asPlugin({
      parentAgentId: "test-agent",
      targets: [],
    });
    expect(plugin).toBeDefined();
    expect(typeof plugin.name).toBe("string");
    expect(plugin.name).toMatch(/^handoff-/);
    expect("register" in plugin).toBe(true);
    if ("register" in plugin) {
      expect(typeof plugin.register).toBe("function");
    }
  });

  it("test_composition_tools_satisfy_custom_tool_contract", () => {
    const readTool = createReadFileTool({ projectRoot: "/tmp" });
    const listTool = createListDirTool({ projectRoot: "/tmp" });
    expect(typeof readTool.name).toBe("string");
    expect(typeof readTool.handler).toBe("function");
    expect(typeof listTool.name).toBe("string");
    expect(typeof listTool.handler).toBe("function");
  });

  it("test_composition_all_three_in_single_options_object", () => {
    // Mock-shape Agent.create options (NOT calling Agent.create — testing
    // pure object construction with all 3 extracted packages composed).
    const cache = Cache.semantic({ embedder: fakeEmbedder });
    const handoffPlugin = Handoff.asPlugin({
      parentAgentId: "host",
      targets: [],
    });
    const composedOptions = {
      name: "host",
      model: { id: "openai/gpt-4o-mini" },
      tools: [createReadFileTool({ projectRoot: "/tmp" }), createListDirTool({ projectRoot: "/tmp" })],
      plugins: [cache.asPlugin(), handoffPlugin],
    };
    expect(composedOptions.tools.length).toBe(2);
    expect(composedOptions.plugins.length).toBe(2);
    expect(composedOptions.plugins[0]?.name).toMatch(/^cache-/);
    expect(composedOptions.plugins[1]?.name).toMatch(/^handoff-/);
  });

  it("test_composition_plugin_names_are_unique — no collision between cache + handoff", () => {
    const cache1 = Cache.semantic({ embedder: fakeEmbedder, namespace: "ns1" });
    const cache2 = Cache.semantic({ embedder: fakeEmbedder, namespace: "ns2" });
    const handoff1 = Handoff.asPlugin({ parentAgentId: "agent-1", targets: [] });
    const handoff2 = Handoff.asPlugin({ parentAgentId: "agent-2", targets: [] });

    const names = new Set([
      cache1.asPlugin().name,
      cache2.asPlugin().name,
      handoff1.name,
      handoff2.name,
    ]);
    // 4 distinct names: 2 cache namespaces + 2 handoff parent ids.
    expect(names.size).toBe(4);
  });
});
