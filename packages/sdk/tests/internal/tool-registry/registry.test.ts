/**
 * Tests for ToolRegistry (T2.1, ADR D102).
 */

import { describe, expect, it } from "vitest";

import { ToolRegistry } from "../../../src/internal/tool-registry/registry.js";

const okHandler = () => "ok";

describe("ToolRegistry (T2.1)", () => {
  it("register then get", () => {
    const r = new ToolRegistry();
    r.register({ name: "t", description: "d", inputSchema: {}, handler: okHandler });
    expect(r.get("t")?.name).toBe("t");
  });

  it("duplicate registration throws", () => {
    const r = new ToolRegistry();
    r.register({ name: "t", description: "d", inputSchema: {}, handler: okHandler });
    expect(() =>
      r.register({ name: "t", description: "d", inputSchema: {}, handler: okHandler }),
    ).toThrow(/already registered/);
  });

  it("list returns all", () => {
    const r = new ToolRegistry();
    r.register({ name: "a", description: "", inputSchema: {}, handler: okHandler });
    r.register({ name: "b", description: "", inputSchema: {}, handler: okHandler });
    expect(r.list()).toHaveLength(2);
  });

  it("has returns boolean", () => {
    const r = new ToolRegistry();
    r.register({ name: "t", description: "", inputSchema: {}, handler: okHandler });
    expect(r.has("t")).toBe(true);
    expect(r.has("missing")).toBe(false);
  });

  it("fromCustomTool extracts shape", () => {
    const custom = {
      name: "search",
      description: "search the web",
      // biome-ignore lint/suspicious/noExplicitAny: test-only shape
      inputSchema: { type: "object" } as any,
      handler: () => "result",
    };
    // biome-ignore lint/suspicious/noExplicitAny: test-only shape
    const entry = ToolRegistry.fromCustomTool(custom as any);
    expect(entry.name).toBe("search");
    expect(entry.description).toBe("search the web");
  });

  it("fromCustomTool with toolset", () => {
    const custom = {
      name: "search",
      description: "",
      // biome-ignore lint/suspicious/noExplicitAny: test-only shape
      inputSchema: {} as any,
      handler: () => "",
    };
    // biome-ignore lint/suspicious/noExplicitAny: test-only shape
    const entry = ToolRegistry.fromCustomTool(custom as any, { toolset: "web" });
    expect(entry.toolset).toBe("web");
  });
});
