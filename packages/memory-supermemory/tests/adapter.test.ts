/**
 * Tests for SupermemoryAdapter — mocked Supermemory SDK via vi.mock.
 *
 * We mock the `supermemory` module so unit tests never touch real HTTP.
 * Real-LLM validation lives in `examples/memory-supermemory-basic/`.
 */

import { MemoryAdapterError, mkMemoryId } from "@theokit/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupermemoryAdapter } from "../src/adapter.js";
import { supermemoryMemory } from "../src/index.js";

// Hoisted mock state so vi.mock factory can use it.
const sdkState = vi.hoisted(() => ({
  addCalls: [] as Array<Record<string, unknown>>,
  searchCalls: [] as Array<Record<string, unknown>>,
  deleteCalls: [] as string[],
  addResult: { id: "doc-default" } as { id: string },
  searchResults: [] as unknown[],
  nextError: undefined as { status?: number; message?: string } | undefined,
}));

vi.mock("supermemory", () => {
  class MockSupermemory {
    documents = {
      add: async (body: Record<string, unknown>) => {
        if (sdkState.nextError) {
          const e = sdkState.nextError;
          sdkState.nextError = undefined;
          const err = new Error(e.message ?? "mock error") as Error & { status?: number };
          if (e.status !== undefined) err.status = e.status;
          throw err;
        }
        sdkState.addCalls.push(body);
        return sdkState.addResult;
      },
      delete: async (id: string) => {
        if (sdkState.nextError) {
          const e = sdkState.nextError;
          sdkState.nextError = undefined;
          const err = new Error(e.message ?? "mock error") as Error & { status?: number };
          if (e.status !== undefined) err.status = e.status;
          throw err;
        }
        sdkState.deleteCalls.push(id);
        return undefined;
      },
    };
    search = {
      memories: async (body: Record<string, unknown>) => {
        if (sdkState.nextError) {
          const e = sdkState.nextError;
          sdkState.nextError = undefined;
          const err = new Error(e.message ?? "mock error") as Error & { status?: number };
          if (e.status !== undefined) err.status = e.status;
          throw err;
        }
        sdkState.searchCalls.push(body);
        return { results: sdkState.searchResults, timing: 1, total: sdkState.searchResults.length };
      },
    };
  }
  return { default: MockSupermemory, Supermemory: MockSupermemory };
});

beforeEach(() => {
  sdkState.addCalls = [];
  sdkState.searchCalls = [];
  sdkState.deleteCalls = [];
  sdkState.addResult = { id: "doc-default" };
  sdkState.searchResults = [];
  sdkState.nextError = undefined;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SupermemoryAdapter (T3.2)", () => {
  it("write calls documents.add with translated containerTags", async () => {
    sdkState.addResult = { id: "doc-abc" };
    const adapter = new SupermemoryAdapter({ apiKey: "sk-test" });
    const id = await adapter.write("hi", { userId: "alice", agentId: "coder" });
    expect(id).toBe("supermemory:doc-abc");
    expect(sdkState.addCalls.length).toBe(1);
    expect(sdkState.addCalls[0]?.content).toBe("hi");
    expect(sdkState.addCalls[0]?.containerTags).toEqual([
      "theokit:user:alice",
      "theokit:agent:coder",
    ]);
  });

  it("recall calls search.memories with primary containerTag and returns typed facts", async () => {
    sdkState.searchResults = [
      { memory: { id: "m-1", content: "fact A", createdAt: "2026-01-01" }, score: 0.9 },
      { memory: { id: "m-2", content: "fact B" }, score: 0.5 },
    ];
    const adapter = new SupermemoryAdapter({ apiKey: "sk-test" });
    const facts = await adapter.recall("music", { userId: "alice" }, 5);
    expect(sdkState.searchCalls[0]).toMatchObject({
      q: "music",
      containerTag: "theokit:user:alice",
      limit: 5,
      rerank: true,
    });
    expect(facts.length).toBe(2);
    expect(facts[0]?.id).toBe("supermemory:m-1");
    expect(facts[0]?.content).toBe("fact A");
    expect(facts[0]?.score).toBe(0.9);
    expect(facts[0]?.createdAt).toBe("2026-01-01");
  });

  it("recall with k=0 returns empty without HTTP", async () => {
    const adapter = new SupermemoryAdapter({ apiKey: "sk-test" });
    const facts = await adapter.recall("music", { userId: "alice" }, 0);
    expect(facts).toEqual([]);
    expect(sdkState.searchCalls.length).toBe(0);
  });

  it("delete round-trips via documents.delete with stripped prefix", async () => {
    const adapter = new SupermemoryAdapter({ apiKey: "sk-test" });
    await adapter.delete(mkMemoryId("supermemory", "doc-xyz"));
    expect(sdkState.deleteCalls).toEqual(["doc-xyz"]);
  });

  // EC-B: cross-adapter MemoryId rejected
  it("EC-B: delete rejects MemoryId minted by a different adapter", async () => {
    const adapter = new SupermemoryAdapter({ apiKey: "sk-test" });
    const honchoId = mkMemoryId("honcho", "h-1");
    await expect(adapter.delete(honchoId)).rejects.toThrow(MemoryAdapterError);
    try {
      await adapter.delete(honchoId);
    } catch (err) {
      expect((err as MemoryAdapterError).code).toBe("invalid_input");
    }
    expect(sdkState.deleteCalls.length).toBe(0);
  });

  // EC-C: userId with colon rejected at boundary, no HTTP
  it("EC-C: write rejects userId with colon (no HTTP attempted)", async () => {
    const adapter = new SupermemoryAdapter({ apiKey: "sk-test" });
    await expect(adapter.write("x", { userId: "user:123" })).rejects.toThrow(MemoryAdapterError);
    expect(sdkState.addCalls.length).toBe(0);
  });

  it("write throws invalid_input on empty content", async () => {
    const adapter = new SupermemoryAdapter({ apiKey: "sk-test" });
    await expect(adapter.write("", { userId: "alice" })).rejects.toThrow(MemoryAdapterError);
    await expect(adapter.write("   ", { userId: "alice" })).rejects.toThrow(MemoryAdapterError);
  });

  it("401 from SDK maps to auth_failed", async () => {
    sdkState.nextError = { status: 401, message: "unauthorized" };
    const adapter = new SupermemoryAdapter({ apiKey: "bad" });
    await expect(adapter.write("hi", { userId: "alice" })).rejects.toMatchObject({
      code: "auth_failed",
      adapterId: "supermemory",
    });
  });

  it("429 from SDK maps to rate_limited", async () => {
    sdkState.nextError = { status: 429, message: "too many" };
    const adapter = new SupermemoryAdapter({ apiKey: "sk-test" });
    await expect(adapter.write("hi", { userId: "alice" })).rejects.toMatchObject({
      code: "rate_limited",
      adapterId: "supermemory",
    });
  });

  it("404 from SDK maps to not_found", async () => {
    sdkState.nextError = { status: 404, message: "no such" };
    const adapter = new SupermemoryAdapter({ apiKey: "sk-test" });
    await expect(adapter.delete(mkMemoryId("supermemory", "missing"))).rejects.toMatchObject({
      code: "not_found",
      adapterId: "supermemory",
    });
  });

  it("unknown tool name throws invalid_input", async () => {
    const adapter = new SupermemoryAdapter({ apiKey: "sk-test" });
    await expect(adapter.handleToolCall("bogus", {}, { userId: "alice" })).rejects.toThrow(
      MemoryAdapterError,
    );
  });

  it("capabilities introspection reports tenancy + toolSchemas true", () => {
    const adapter = new SupermemoryAdapter({ apiKey: "sk-test" });
    expect(adapter.capabilities.tenancy).toBe(true);
    expect(adapter.capabilities.toolSchemas).toBe(true);
    expect(adapter.capabilities.history).toBe(false);
  });

  it("factory returns a valid Plugin { kind: 'memory' }", () => {
    const plugin = supermemoryMemory({ apiKey: "sk-test" });
    expect(plugin.kind).toBe("memory");
    expect(plugin.name).toBe("@theokit/memory-supermemory");
    if (plugin.kind !== "memory") throw new Error("type narrow");
    expect(typeof plugin.createProvider).toBe("function");
  });
});
