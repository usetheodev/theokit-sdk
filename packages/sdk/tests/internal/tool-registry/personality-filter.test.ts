/**
 * Tests for applyPersonalityFilter (T4.1, ADR D167 + EC-I MCP names).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetWarnOnceForTests } from "../../../src/internal/runtime/hooks-source.js";
import { applyPersonalityFilter } from "../../../src/internal/tool-registry/personality-filter.js";

describe("applyPersonalityFilter (T4.1)", () => {
  beforeEach(() => {
    _resetWarnOnceForTests();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("undefined whitelist returns unchanged", () => {
    const tools = [{ name: "read" }, { name: "write" }];
    const result = applyPersonalityFilter(tools, undefined);
    expect(result).toBe(tools);
  });

  it("empty whitelist returns empty set", () => {
    const tools = [{ name: "read" }, { name: "write" }];
    const result = applyPersonalityFilter(tools, []);
    expect(result).toEqual([]);
  });

  it("whitelist filters to subset", () => {
    const tools = [{ name: "read" }, { name: "write" }, { name: "exec" }];
    const result = applyPersonalityFilter(tools, ["read", "exec"]);
    expect(result.map((t) => t.name)).toEqual(["read", "exec"]);
  });

  it("missing tool warns once per (agentId, personality, tool) combo", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const tools = [{ name: "read" }];
    applyPersonalityFilter(tools, ["ghost"], { agentId: "a1", personalityName: "p1" });
    applyPersonalityFilter(tools, ["ghost"], { agentId: "a1", personalityName: "p1" });
    const ghostWrites = stderr.mock.calls
      .flat()
      .filter((s) => typeof s === "string" && s.includes('unknown tool "ghost"'));
    expect(ghostWrites.length).toBe(1);
    stderr.mockRestore();
  });

  it("EC-15: duplicate whitelist entries deduped silently", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const tools = [{ name: "read" }];
    const result = applyPersonalityFilter(tools, ["read", "read", "read"]);
    expect(result.map((t) => t.name)).toEqual(["read"]);
    // No warning fired (no missing tool referenced).
    const writes = stderr.mock.calls
      .flat()
      .filter((s) => typeof s === "string" && s.includes("personality"));
    expect(writes.length).toBe(0);
    stderr.mockRestore();
  });

  it("EC-17: typo within Levenshtein <=2 warns with did-you-mean hint", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const tools = [{ name: "read_file" }];
    applyPersonalityFilter(tools, ["raed_file"], { personalityName: "p1" });
    const hinted = stderr.mock.calls
      .flat()
      .filter((s) => typeof s === "string" && s.includes('did you mean "read_file"'));
    expect(hinted.length).toBeGreaterThanOrEqual(1);
    stderr.mockRestore();
  });

  it("EC-I: MCP-style names like mcp__server__tool match as exact strings", () => {
    const tools = [{ name: "mcp__github__create_issue" }, { name: "read" }];
    const result = applyPersonalityFilter(tools, ["mcp__github__create_issue"]);
    expect(result.map((t) => t.name)).toEqual(["mcp__github__create_issue"]);
  });
});
