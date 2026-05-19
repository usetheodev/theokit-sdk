/**
 * Tests for Toolset (T2.2, ADR D104).
 */

import { describe, expect, it } from "vitest";

import { ToolRegistry } from "../../../src/internal/tool-registry/registry.js";
import {
  CORE_TOOLSET,
  resolveToolset,
  resolveToolsetStrict,
} from "../../../src/internal/tool-registry/toolset.js";

function reg(names: string[]): ToolRegistry {
  const r = new ToolRegistry();
  for (const n of names) {
    r.register({ name: n, description: "", inputSchema: {}, handler: () => "" });
  }
  return r;
}

describe("Toolset (T2.2)", () => {
  it("resolves to entries", () => {
    const r = reg(["a", "b", "c"]);
    const ts = { name: "ts", tools: ["a", "b"] };
    expect(resolveToolset(ts, r).map((e) => e.name)).toEqual(["a", "b"]);
  });

  it("drops missing tools silently", () => {
    const r = reg(["a"]);
    const ts = { name: "ts", tools: ["a", "missing"] };
    expect(resolveToolset(ts, r).map((e) => e.name)).toEqual(["a"]);
  });

  it("strict variant throws on missing", () => {
    const r = reg(["a"]);
    const ts = { name: "ts", tools: ["a", "missing"] };
    expect(() => resolveToolsetStrict(ts, r)).toThrow(/unknown tool "missing"/);
  });

  it("empty toolset returns empty", () => {
    const r = reg([]);
    expect(resolveToolset({ name: "ts", tools: [] }, r)).toEqual([]);
  });

  it("CORE_TOOLSET constant has shape", () => {
    expect(CORE_TOOLSET.name).toBe("core");
    expect(CORE_TOOLSET.tools.length).toBeGreaterThan(0);
  });

  it("EC-7: duplicates kept; caller dedup responsibility", () => {
    const r = reg(["shell"]);
    const ts = { name: "ts", tools: ["shell", "shell"] };
    const resolved = resolveToolset(ts, r);
    expect(resolved).toHaveLength(2);
    expect(resolved[0]).toBe(resolved[1]); // same ref
  });
});
