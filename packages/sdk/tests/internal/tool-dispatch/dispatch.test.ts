/**
 * Tests for dispatchToolWithRepair (T1.3, ADR D89).
 */

import { describe, expect, it } from "vitest";

import {
  type DispatchableTool,
  dispatchToolWithRepair,
} from "../../../src/internal/tool-dispatch/dispatch.js";

function makeRegistry(tools: DispatchableTool[]): ReadonlyMap<string, DispatchableTool> {
  return new Map(tools.map((t) => [t.name, t]));
}

describe("dispatchToolWithRepair (T1.3)", () => {
  it("returns isError for unknown tool", async () => {
    const result = await dispatchToolWithRepair(
      { name: "nonexistent", args: {}, id: "1" },
      makeRegistry([{ name: "search", inputSchema: { properties: {} }, handler: () => "ok" }]),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Unknown tool");
  });

  it("lists available tools in unknown error", async () => {
    const result = await dispatchToolWithRepair(
      { name: "xyz", args: {}, id: "1" },
      makeRegistry([
        { name: "search", inputSchema: { properties: {} }, handler: () => "" },
        { name: "fetch", inputSchema: { properties: {} }, handler: () => "" },
      ]),
    );
    expect(result.content).toContain("search");
    expect(result.content).toContain("fetch");
  });

  it("validates args when validate fn provided", async () => {
    let handlerCalled = false;
    const result = await dispatchToolWithRepair(
      { name: "limit", args: { count: -1 }, id: "1" },
      makeRegistry([
        {
          name: "limit",
          inputSchema: { properties: { count: { type: "number" } } },
          validate: (a) => {
            const args = a as { count: number };
            if (args.count < 0) return { ok: false, reason: "count must be >= 0" };
            return { ok: true, value: args };
          },
          handler: () => {
            handlerCalled = true;
            return "ok";
          },
        },
      ]),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Invalid arguments");
    expect(result.content).toContain("count must be >= 0");
    expect(handlerCalled).toBe(false);
  });

  it("invalid args returns isError without calling handler", async () => {
    const result = await dispatchToolWithRepair(
      { name: "search", args: {}, id: "1" },
      makeRegistry([
        {
          name: "search",
          inputSchema: { properties: {} },
          validate: () => ({ ok: false, reason: "missing q" }),
          handler: () => "called",
        },
      ]),
    );
    expect(result.isError).toBe(true);
    expect(result.content).not.toBe("called");
  });

  it("executes handler on valid args", async () => {
    const result = await dispatchToolWithRepair(
      { name: "search", args: { q: "foo" }, id: "1" },
      makeRegistry([
        {
          name: "search",
          inputSchema: { properties: { q: { type: "string" } } },
          handler: (args) => `searched ${(args as { q: string }).q}`,
        },
      ]),
    );
    expect(result.isError).toBe(false);
    expect(result.content).toBe("searched foo");
  });

  it("handler throw returns isError, does not propagate", async () => {
    const result = await dispatchToolWithRepair(
      { name: "boom", args: {}, id: "1" },
      makeRegistry([
        {
          name: "boom",
          inputSchema: { properties: {} },
          handler: () => {
            throw new Error("boom error");
          },
        },
      ]),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Tool execution failed");
    expect(result.content).toContain("boom error");
  });

  it("repairs propagate to result", async () => {
    const result = await dispatchToolWithRepair(
      { name: "SEARCH", args: '{"q":"foo"}', id: "1" },
      makeRegistry([
        {
          name: "search",
          inputSchema: { properties: { q: { type: "string" } } },
          handler: (args) => `searched ${(args as { q: string }).q}`,
        },
      ]),
    );
    expect(result.isError).toBe(false);
    expect(result.repairs.length).toBeGreaterThan(0);
    expect(result.repairs.some((r) => r.includes("SEARCH"))).toBe(true);
    expect(result.repairs.some((r) => r.includes("parsed from string"))).toBe(true);
  });

  it("dispatch case-insensitive: SEARCH dispatched OK", async () => {
    const result = await dispatchToolWithRepair(
      { name: "SEARCH", args: { q: "foo" }, id: "1" },
      makeRegistry([
        {
          name: "search",
          inputSchema: { properties: { q: { type: "string" } } },
          handler: () => "ok",
        },
      ]),
    );
    expect(result.isError).toBe(false);
  });

  it("dispatch with stringified args: parsed and executed", async () => {
    const result = await dispatchToolWithRepair(
      { name: "search", args: '{"q":"foo"}', id: "1" },
      makeRegistry([
        {
          name: "search",
          inputSchema: { properties: { q: { type: "string" } } },
          handler: (args) => (args as { q: string }).q,
        },
      ]),
    );
    expect(result.isError).toBe(false);
    expect(result.content).toBe("foo");
  });
});
