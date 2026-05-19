/**
 * Tests for repair-middleware (T1.1, ADRs D87-D88).
 */

import { describe, expect, it } from "vitest";

import {
  coerceArgsToSchema,
  type RepairableTool,
  repairToolCall,
  type ToolCall,
} from "../../../src/internal/tool-dispatch/repair-middleware.js";

function makeRegistry(tools: RepairableTool[]): ReadonlyMap<string, RepairableTool> {
  return new Map(tools.map((t) => [t.name, t]));
}

describe("repairToolCall (T1.1)", () => {
  it("no-op when name matches and args are well-formed", () => {
    const registry = makeRegistry([
      { name: "search", inputSchema: { properties: { q: { type: "string" } } } },
    ]);
    const result = repairToolCall({ name: "search", args: { q: "foo" }, id: "1" }, registry);
    expect(result.repairs).toEqual([]);
    expect(result.call).toEqual({ name: "search", args: { q: "foo" }, id: "1" });
  });

  it("case-insensitive name match: SEARCH → search", () => {
    const registry = makeRegistry([{ name: "search", inputSchema: { properties: {} } }]);
    const result = repairToolCall({ name: "SEARCH", args: {}, id: "1" }, registry);
    expect(result.call.name).toBe("search");
    expect(result.repairs).toContain('name: "SEARCH" → "search"');
  });

  it("args parsed from JSON string", () => {
    const registry = makeRegistry([
      { name: "search", inputSchema: { properties: { q: { type: "string" } } } },
    ]);
    const result = repairToolCall({ name: "search", args: '{"q":"foo"}', id: "1" }, registry);
    expect(result.call.args).toEqual({ q: "foo" });
    expect(result.repairs).toContain("args: parsed from string");
  });

  it("coerce string to number", () => {
    const registry = makeRegistry([
      { name: "limit", inputSchema: { properties: { count: { type: "number" } } } },
    ]);
    const result = repairToolCall({ name: "limit", args: { count: "3" }, id: "1" }, registry);
    expect(result.call.args).toEqual({ count: 3 });
    expect(result.repairs).toContain("count: string→number");
  });

  it("EC-3: coerce string to integer", () => {
    const registry = makeRegistry([
      { name: "limit", inputSchema: { properties: { count: { type: "integer" } } } },
    ]);
    const result = repairToolCall({ name: "limit", args: { count: "5" }, id: "1" }, registry);
    expect(result.call.args).toEqual({ count: 5 });
    expect(result.repairs).toContain("count: string→integer");
  });

  it("coerce string to boolean", () => {
    const registry = makeRegistry([
      { name: "flag", inputSchema: { properties: { enabled: { type: "boolean" } } } },
    ]);
    const result = repairToolCall({ name: "flag", args: { enabled: "true" }, id: "1" }, registry);
    expect(result.call.args).toEqual({ enabled: true });
    expect(result.repairs).toContain("enabled: string→boolean");
  });

  it("coerce string to array", () => {
    const registry = makeRegistry([
      { name: "list", inputSchema: { properties: { items: { type: "array" } } } },
    ]);
    const result = repairToolCall({ name: "list", args: { items: "[1,2,3]" }, id: "1" }, registry);
    expect(result.call.args).toEqual({ items: [1, 2, 3] });
    expect(result.repairs).toContain("items: string→array");
  });

  it("no fuzzy match — unknown name passes through unchanged", () => {
    const registry = makeRegistry([{ name: "write_file", inputSchema: { properties: {} } }]);
    const result = repairToolCall(
      { name: "file_writter", args: {}, id: "1" }, // typo
      registry,
    );
    expect(result.call.name).toBe("file_writter");
    expect(result.repairs).toEqual([]);
  });

  it("idempotent — applying twice produces empty repairs second time", () => {
    const registry = makeRegistry([
      { name: "limit", inputSchema: { properties: { count: { type: "number" } } } },
    ]);
    const r1 = repairToolCall({ name: "LIMIT", args: { count: "3" }, id: "1" }, registry);
    const r2 = repairToolCall(r1.call, registry);
    expect(r2.repairs).toEqual([]);
    expect(r2.call).toEqual(r1.call);
  });

  it("preserves raw input — does not mutate", () => {
    const raw: ToolCall = { name: "SEARCH", args: { count: "3" }, id: "1" };
    const rawSnapshot = JSON.parse(JSON.stringify(raw));
    const registry = makeRegistry([
      { name: "search", inputSchema: { properties: { count: { type: "number" } } } },
    ]);
    repairToolCall(raw, registry);
    expect(raw).toEqual(rawSnapshot);
  });

  it("null args pass through without throw", () => {
    const registry = makeRegistry([{ name: "noop", inputSchema: { properties: {} } }]);
    expect(() => repairToolCall({ name: "noop", args: null, id: "1" }, registry)).not.toThrow();
  });

  it("empty registry returns raw with no repairs", () => {
    const result = repairToolCall({ name: "anything", args: { x: 1 }, id: "1" }, new Map());
    expect(result.call.name).toBe("anything");
    expect(result.repairs).toEqual([]);
  });
});

describe("coerceArgsToSchema (T1.1)", () => {
  it("no change when schema has no properties", () => {
    const result = coerceArgsToSchema({ x: "5" }, {});
    expect(result.changed).toEqual([]);
    expect(result.value).toEqual({ x: "5" });
  });

  it("logs each coerced field", () => {
    const result = coerceArgsToSchema(
      { count: "3", flag: "false" },
      {
        properties: {
          count: { type: "number" },
          flag: { type: "boolean" },
        },
      },
    );
    expect(result.changed).toContain("count: string→number");
    expect(result.changed).toContain("flag: string→boolean");
  });
});
