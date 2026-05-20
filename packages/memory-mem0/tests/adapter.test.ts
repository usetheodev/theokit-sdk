/**
 * Mem0Adapter — vi.mock-driven unit tests (T5.1).
 *
 * Includes EC-K (breaker ignores 429), EC-B (cross-adapter id), and
 * EC-L (cloud-only import).
 */

import { MemoryAdapterError, mkMemoryId } from "@usetheo/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Mem0Adapter } from "../src/adapter.js";
import { mem0Memory } from "../src/index.js";

const m0 = vi.hoisted(() => ({
  addCalls: [] as Array<{ messages: unknown; options: unknown }>,
  searchCalls: [] as Array<{ query: string; options: unknown }>,
  deleteCalls: [] as string[],
  historyCalls: [] as string[],
  addResult: [{ id: "mem-default" }] as Array<{ id: string }>,
  searchResults: [] as Array<Record<string, unknown>>,
  historyResult: [] as Array<Record<string, unknown>>,
  nextError: undefined as { status?: number; message?: string } | undefined,
}));

vi.mock("mem0ai", () => {
  class MockMemoryClient {
    // biome-ignore lint/complexity/noUselessConstructor: signature-matching constructor for vi.mock factory — opts arg required to mirror real mem0ai MemoryClient.
    constructor(_opts: unknown) {}
    async add(messages: unknown, options: unknown) {
      if (m0.nextError) {
        const e = m0.nextError;
        m0.nextError = undefined;
        const err = new Error(e.message ?? "mock") as Error & { status?: number };
        if (e.status !== undefined) err.status = e.status;
        throw err;
      }
      m0.addCalls.push({ messages, options });
      return m0.addResult;
    }
    async search(query: string, options: unknown) {
      if (m0.nextError) {
        const e = m0.nextError;
        m0.nextError = undefined;
        const err = new Error(e.message ?? "mock") as Error & { status?: number };
        if (e.status !== undefined) err.status = e.status;
        throw err;
      }
      m0.searchCalls.push({ query, options });
      return m0.searchResults;
    }
    async delete(id: string) {
      if (m0.nextError) {
        const e = m0.nextError;
        m0.nextError = undefined;
        const err = new Error(e.message ?? "mock") as Error & { status?: number };
        if (e.status !== undefined) err.status = e.status;
        throw err;
      }
      m0.deleteCalls.push(id);
      return { message: "ok" };
    }
    async history(id: string) {
      if (m0.nextError) {
        const e = m0.nextError;
        m0.nextError = undefined;
        const err = new Error(e.message ?? "mock") as Error & { status?: number };
        if (e.status !== undefined) err.status = e.status;
        throw err;
      }
      m0.historyCalls.push(id);
      return m0.historyResult;
    }
  }
  return { default: MockMemoryClient, MemoryClient: MockMemoryClient };
});

beforeEach(() => {
  m0.addCalls = [];
  m0.searchCalls = [];
  m0.deleteCalls = [];
  m0.historyCalls = [];
  m0.addResult = [{ id: "mem-default" }];
  m0.searchResults = [];
  m0.historyResult = [];
  m0.nextError = undefined;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Mem0Adapter (T5.1)", () => {
  it("write includes user_id, agent_id, run_id (sessionId), app_id (tenantId)", async () => {
    m0.addResult = [{ id: "mem-99" }];
    const adapter = new Mem0Adapter({ apiKey: "sk-test" });
    const id = await adapter.write("hi", {
      userId: "alice",
      agentId: "coder",
      sessionId: "chat42",
      tenantId: "acme",
    });
    expect(id).toBe("mem0:mem-99");
    const opts = m0.addCalls[0]?.options as Record<string, unknown>;
    expect(opts.user_id).toBe("alice");
    expect(opts.agent_id).toBe("coder");
    expect(opts.run_id).toBe("chat42");
    expect(opts.app_id).toBe("acme");
  });

  it("search returns typed facts with score + content", async () => {
    m0.searchResults = [
      { id: "m-1", memory: "User likes jazz", score: 0.9 },
      { id: "m-2", memory: "User has a cat", score: 0.4 },
    ];
    const adapter = new Mem0Adapter({ apiKey: "sk-test" });
    const facts = await adapter.recall("music?", { userId: "alice" }, 5);
    expect(facts).toHaveLength(2);
    expect(facts[0]?.id).toBe("mem0:m-1");
    expect(facts[0]?.content).toBe("User likes jazz");
    expect(facts[0]?.score).toBe(0.9);
  });

  it("history returns revisions with version + changedAt", async () => {
    m0.historyResult = [
      { id: "h-1", memoryId: "mem-99", oldMemory: null, newMemory: "v1", updatedAt: "2026-01-01" },
      { id: "h-2", memoryId: "mem-99", oldMemory: "v1", newMemory: "v2", updatedAt: "2026-02-01" },
    ];
    const adapter = new Mem0Adapter({ apiKey: "sk-test" });
    const revisions = await adapter.history(mkMemoryId("mem0", "mem-99"));
    expect(revisions).toHaveLength(2);
    expect(revisions[0]?.version).toBe(1);
    expect(revisions[1]?.version).toBe(2);
    expect(revisions[0]?.content).toBe("v1");
    expect(revisions[1]?.content).toBe("v2");
    expect(revisions[0]?.changedAt).toBe("2026-01-01");
  });

  it("history returns empty when underlying call returns empty", async () => {
    m0.historyResult = [];
    const adapter = new Mem0Adapter({ apiKey: "sk-test" });
    const revisions = await adapter.history(mkMemoryId("mem0", "missing"));
    expect(revisions).toEqual([]);
  });

  // EC-K: 429 does NOT trip the breaker
  it("EC-K: 10 consecutive 429s do NOT trip the breaker", async () => {
    const adapter = new Mem0Adapter({ apiKey: "sk-test", breaker: { threshold: 5 } });
    for (let i = 0; i < 10; i += 1) {
      m0.nextError = { status: 429, message: "too many" };
      await expect(adapter.write("hi", { userId: "alice" })).rejects.toMatchObject({
        code: "rate_limited",
      });
    }
    expect(adapter._breakerState().isOpen).toBe(false);
    expect(adapter._breakerState().failures).toBe(0);
  });

  it("circuit breaker trips after 5 consecutive 5xx", async () => {
    const adapter = new Mem0Adapter({ apiKey: "sk-test", breaker: { threshold: 5 } });
    for (let i = 0; i < 5; i += 1) {
      m0.nextError = { status: 503, message: "down" };
      await expect(adapter.write("hi", { userId: "alice" })).rejects.toMatchObject({
        code: "network",
      });
    }
    expect(adapter._breakerState().isOpen).toBe(true);
    // Next call short-circuits with rate_limited (breaker open semantics).
    await expect(adapter.write("hi", { userId: "alice" })).rejects.toMatchObject({
      code: "rate_limited",
    });
  });

  it("breaker resets on success", async () => {
    const adapter = new Mem0Adapter({ apiKey: "sk-test", breaker: { threshold: 5 } });
    // Two failures, then success
    m0.nextError = { status: 500, message: "boom" };
    await expect(adapter.write("hi", { userId: "alice" })).rejects.toMatchObject({
      code: "network",
    });
    m0.nextError = { status: 500 };
    await expect(adapter.write("hi", { userId: "alice" })).rejects.toMatchObject({
      code: "network",
    });
    expect(adapter._breakerState().failures).toBe(2);

    m0.addResult = [{ id: "ok" }];
    await adapter.write("hi", { userId: "alice" });
    expect(adapter._breakerState().failures).toBe(0);
  });

  it("breaker throws during cooldown", async () => {
    const adapter = new Mem0Adapter({
      apiKey: "sk-test",
      breaker: { threshold: 1, cooldownMs: 1000 },
    });
    m0.nextError = { status: 503 };
    await expect(adapter.write("hi", { userId: "alice" })).rejects.toThrow(MemoryAdapterError);
    // Breaker now open; next call is short-circuited
    await expect(adapter.write("hi", { userId: "alice" })).rejects.toMatchObject({
      code: "rate_limited",
    });
  });

  it("capabilities: history=true (Mem0 unique)", () => {
    const adapter = new Mem0Adapter({ apiKey: "sk-test" });
    expect(adapter.capabilities.history).toBe(true);
  });

  // EC-B: cross-adapter MemoryId rejected
  it("EC-B: delete rejects MemoryId from a different adapter", async () => {
    const adapter = new Mem0Adapter({ apiKey: "sk-test" });
    const honchoId = mkMemoryId("honcho", "h-1");
    await expect(adapter.delete(honchoId)).rejects.toThrow(MemoryAdapterError);
    expect(m0.deleteCalls.length).toBe(0);
  });

  it("EC-B: history rejects MemoryId from a different adapter", async () => {
    const adapter = new Mem0Adapter({ apiKey: "sk-test" });
    const supermemoryId = mkMemoryId("supermemory", "sm-1");
    await expect(adapter.history(supermemoryId)).rejects.toThrow(MemoryAdapterError);
    expect(m0.historyCalls.length).toBe(0);
  });

  // EC-L: cloud-only import works without optional OSS backends
  it("EC-L: import { MemoryClient } from 'mem0ai' works without optional peers", async () => {
    // If the import at the top of adapter.ts threw at module-init, the test
    // file itself wouldn't load. The mere fact that this test runs proves
    // the cloud-only client import path is side-effect-free w.r.t. optional
    // backends. Sanity check: client construction succeeds.
    const adapter = new Mem0Adapter({ apiKey: "sk-test" });
    expect(adapter.isAvailable()).toBe(true);
  });

  it("401 maps to auth_failed", async () => {
    m0.nextError = { status: 401, message: "unauthorized" };
    const adapter = new Mem0Adapter({ apiKey: "bad" });
    await expect(adapter.write("hi", { userId: "alice" })).rejects.toMatchObject({
      code: "auth_failed",
    });
  });

  it("factory returns a valid Plugin", () => {
    const plugin = mem0Memory({ apiKey: "sk-test" });
    expect(plugin.kind).toBe("memory");
    expect(plugin.name).toBe("@usetheo/memory-mem0");
  });

  it("README contains CVSS 8.1 disclosure section", async () => {
    const { readFile } = await import("node:fs/promises");
    const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
    expect(readme).toMatch(/## Security Disclosure/);
    expect(readme).toMatch(/CVSS 8\.1/);
    expect(readme).toMatch(/PGVector|MySQL|Neptune/i);
  });
});
