/**
 * Tests for MemoryAdapter contract (T1.1, ADRs D141 / D147).
 *
 * Compile + runtime checks for the formal interface, the `MemoryId`
 * prefix scheme (EC-B), and the `MemoryAdapterError` class.
 */

import { describe, expect, expectTypeOf, it } from "vitest";

import { MemoryAdapterError, TheokitAgentError } from "../../src/errors.js";
import { extractRawId, mkMemoryId } from "../../src/memory-adapter-helpers.js";
import type { MemoryAdapter, MemoryContext, MemoryId } from "../../src/types/memory-adapter.js";

describe("MemoryAdapter contract (T1.1)", () => {
  it("MemoryAdapter type compiles with all required fields", () => {
    const adapter: MemoryAdapter = {
      id: "test",
      capabilities: {
        history: false,
        sessions: false,
        tenancy: false,
        reasoning: false,
        toolSchemas: false,
        prefetch: false,
      },
      isAvailable: () => true,
      write: async () => mkMemoryId("test", "1"),
      recall: async () => [],
      delete: async () => {},
    };
    expect(adapter.id).toBe("test");
  });

  it("MemoryId is opaque — plain string cannot be assigned to MemoryId", () => {
    // Compile-time check via expectTypeOf
    expectTypeOf<string>().not.toMatchTypeOf<MemoryId>();
    expectTypeOf<MemoryId>().toMatchTypeOf<string>();
  });

  it("mkMemoryId embeds adapter prefix", () => {
    const id = mkMemoryId("supermemory", "abc-123");
    expect(id).toBe("supermemory:abc-123");
  });

  it("extractRawId round-trips mkMemoryId for the same adapter", () => {
    const id = mkMemoryId("mem0", "fact-42");
    expect(extractRawId(id, "mem0")).toBe("fact-42");
  });

  it("extractRawId rejects MemoryId from a different adapter (EC-B)", () => {
    const supermemoryId = mkMemoryId("supermemory", "abc");
    expect(() => extractRawId(supermemoryId, "mem0")).toThrow(MemoryAdapterError);
    try {
      extractRawId(supermemoryId, "mem0");
    } catch (err) {
      expect(err).toBeInstanceOf(MemoryAdapterError);
      const e = err as MemoryAdapterError;
      expect(e.code).toBe("invalid_input");
      expect(e.adapterId).toBe("mem0");
      expect(e.message).toContain("supermemory");
      expect(e.message).toContain("mem0");
    }
  });

  it("MemoryContext requires userId (compile-time)", () => {
    // userId is required — these compile-time assertions exercise the type
    const valid: MemoryContext = { userId: "alice" };
    expect(valid.userId).toBe("alice");
    expectTypeOf<{ userId: string }>().toMatchTypeOf<MemoryContext>();
    // Without userId would fail to compile — verified by tsc gate
  });

  it("MemoryAdapterError extends TheokitAgentError", () => {
    const err = new MemoryAdapterError("boom", { adapterId: "test", code: "auth_failed" });
    expect(err).toBeInstanceOf(TheokitAgentError);
    expect(err).toBeInstanceOf(MemoryAdapterError);
    expect(err.name).toBe("MemoryAdapterError");
  });

  it("MemoryAdapterError carries adapterId + code", () => {
    const err = new MemoryAdapterError("rate hit", {
      adapterId: "mem0",
      code: "rate_limited",
    });
    expect(err.adapterId).toBe("mem0");
    expect(err.code).toBe("rate_limited");
    expect(err.isRetryable).toBe(true);
  });

  it("capabilities introspection narrows call sites at compile time", () => {
    const adapter: MemoryAdapter = {
      id: "mem0",
      capabilities: {
        history: true,
        sessions: true,
        tenancy: true,
        reasoning: false,
        toolSchemas: true,
        prefetch: false,
      },
      isAvailable: () => true,
      write: async () => mkMemoryId("mem0", "1"),
      recall: async () => [],
      delete: async () => {},
      history: async () => [
        { id: mkMemoryId("mem0", "1"), content: "v1", version: 1, changedAt: "" },
      ],
    };
    // Type guard: only Mem0 implements history()
    if (adapter.capabilities.history) {
      expect(typeof adapter.history).toBe("function");
    }
  });
});
