/**
 * T2.2 — `agent.memory` direct API (ADR D141 / D142).
 *
 * Uses fixture mode so no LLM hits the wire. Builds a fake memory
 * adapter via `Plugin.create({ kind: "memory" })` and asserts the
 * fan-out / merge / dedupe / lazy-init contract.
 */

import { describe, expect, it } from "vitest";

import { Agent } from "../src/agent.js";
import { ConfigurationError } from "../src/errors.js";
import { Plugin } from "../src/internal/plugins/types.js";
import { mkMemoryId } from "../src/memory-adapter-helpers.js";
import { useTempCwd } from "./helpers/temp-workspace.js";

// This file creates agents without naming a cwd — `local: {}` and an omitted `local` both fall
// back to process.cwd(), which during a test run is the package itself, so the sessions landed
// in packages/sdk/.theokit/. See useTempCwd's docblock for the 540 MB that bought.
useTempCwd();

import type {
  MemoryAdapter,
  MemoryAdapterCapabilities,
  MemoryFact,
  MemoryId,
} from "../src/types/memory-adapter.js";

const noCaps: MemoryAdapterCapabilities = {
  history: false,
  sessions: false,
  tenancy: false,
  reasoning: false,
  toolSchemas: false,
  prefetch: false,
};

interface FakeAdapterScript {
  id: string;
  writeReturns?: (content: unknown) => MemoryId | Promise<MemoryId>;
  recallReturns?: (q: string) => MemoryFact[] | Promise<MemoryFact[]>;
  onInitialize?: () => void;
  writeThrows?: Error;
  recallThrows?: Error;
}

function makeFakeAdapter(script: FakeAdapterScript): MemoryAdapter {
  return {
    id: script.id,
    capabilities: noCaps,
    isAvailable: () => true,
    initialize: async () => {
      script.onInitialize?.();
    },
    write: async (content) => {
      if (script.writeThrows) throw script.writeThrows;
      return script.writeReturns
        ? await script.writeReturns(content)
        : mkMemoryId(script.id, "default");
    },
    recall: async (q) => {
      if (script.recallThrows) throw script.recallThrows;
      return script.recallReturns ? await script.recallReturns(q) : [];
    },
    delete: async () => {},
  };
}

function makeMemoryPlugin(adapter: MemoryAdapter, name = "fake-mem") {
  return Plugin.create({
    name,
    version: "1.0.0",
    kind: "memory",
    createProvider: () => adapter,
  });
}

const baseOptions = {
  apiKey: "theo_test_memory_direct",
  model: { id: "openai/gpt-4o-mini" },
  local: {},
  memoryContext: { userId: "demo" },
};

describe("agent.memory direct API (T2.2)", () => {
  it("agent.memory.write dispatches to the registered adapter", async () => {
    let received = "";
    const adapter = makeFakeAdapter({
      id: "fake",
      writeReturns: (content) => {
        received = String(content);
        return mkMemoryId("fake", "abc-123");
      },
    });
    const agent = await Agent.create({
      ...baseOptions,
      plugins: [
        makeMemoryPlugin(adapter),
      ] as unknown as import("../src/types/agent.js").AgentOptions["plugins"],
    });
    try {
      const id = await agent.memory!.write("hello", { userId: "demo" });
      expect(id).toBe("fake:abc-123");
      expect(received).toBe("hello");
    } finally {
      await agent.dispose();
    }
  });

  it("agent.memory.recall returns facts from the adapter", async () => {
    const adapter = makeFakeAdapter({
      id: "fake",
      recallReturns: () => [
        { id: mkMemoryId("fake", "1"), content: "alpha" },
        { id: mkMemoryId("fake", "2"), content: "beta" },
      ],
    });
    const agent = await Agent.create({
      ...baseOptions,
      plugins: [
        makeMemoryPlugin(adapter),
      ] as unknown as import("../src/types/agent.js").AgentOptions["plugins"],
    });
    try {
      const facts = await agent.memory!.recall("music", { userId: "demo" });
      expect(facts.map((f) => f.content)).toEqual(["alpha", "beta"]);
    } finally {
      await agent.dispose();
    }
  });

  it("agent.memory.write throws ConfigurationError when no adapter is registered", async () => {
    const agent = await Agent.create(baseOptions);
    try {
      await expect(agent.memory!.write("x", { userId: "demo" })).rejects.toThrow(
        ConfigurationError,
      );
    } finally {
      await agent.dispose();
    }
  });

  it("multi-adapter write fans out to all adapters", async () => {
    const calls: string[] = [];
    const a = makeFakeAdapter({
      id: "a",
      writeReturns: () => {
        calls.push("a");
        return mkMemoryId("a", "1");
      },
    });
    const b = makeFakeAdapter({
      id: "b",
      writeReturns: () => {
        calls.push("b");
        return mkMemoryId("b", "1");
      },
    });
    const agent = await Agent.create({
      ...baseOptions,
      plugins: [
        makeMemoryPlugin(a, "plugin-a"),
        makeMemoryPlugin(b, "plugin-b"),
      ] as unknown as import("../src/types/agent.js").AgentOptions["plugins"],
    });
    try {
      const id = await agent.memory!.write("hi", { userId: "demo" });
      expect(calls.sort()).toEqual(["a", "b"]);
      expect(id.startsWith("a:") || id.startsWith("b:")).toBe(true);
    } finally {
      await agent.dispose();
    }
  });

  it("multi-adapter recall merges results and dedupes by content", async () => {
    const a = makeFakeAdapter({
      id: "a",
      recallReturns: () => [
        { id: mkMemoryId("a", "1"), content: "same fact" },
        { id: mkMemoryId("a", "2"), content: "unique-a" },
      ],
    });
    const b = makeFakeAdapter({
      id: "b",
      recallReturns: () => [
        { id: mkMemoryId("b", "1"), content: "same fact" },
        { id: mkMemoryId("b", "2"), content: "unique-b" },
      ],
    });
    const agent = await Agent.create({
      ...baseOptions,
      plugins: [
        makeMemoryPlugin(a, "plugin-a"),
        makeMemoryPlugin(b, "plugin-b"),
      ] as unknown as import("../src/types/agent.js").AgentOptions["plugins"],
    });
    try {
      const facts = await agent.memory!.recall("q", { userId: "demo" });
      const contents = facts.map((f) => f.content).sort();
      expect(contents).toEqual(["same fact", "unique-a", "unique-b"]);
    } finally {
      await agent.dispose();
    }
  });

  it("multi-adapter partial failure returns success from healthy adapters", async () => {
    const broken = makeFakeAdapter({ id: "broken", recallThrows: new Error("network") });
    const ok = makeFakeAdapter({
      id: "ok",
      recallReturns: () => [{ id: mkMemoryId("ok", "1"), content: "survived" }],
    });
    const agent = await Agent.create({
      ...baseOptions,
      plugins: [
        makeMemoryPlugin(broken, "p-broken"),
        makeMemoryPlugin(ok, "p-ok"),
      ] as unknown as import("../src/types/agent.js").AgentOptions["plugins"],
    });
    try {
      const facts = await agent.memory!.recall("q", { userId: "demo" });
      expect(facts.map((f) => f.content)).toEqual(["survived"]);
    } finally {
      await agent.dispose();
    }
  });

  // EC-I: initialize() called exactly once on first access
  it("EC-I: first memory.write triggers initialize() exactly once", async () => {
    let initCount = 0;
    const adapter = makeFakeAdapter({
      id: "lazy",
      onInitialize: () => {
        initCount += 1;
      },
      writeReturns: () => mkMemoryId("lazy", "1"),
    });
    const agent = await Agent.create({
      ...baseOptions,
      plugins: [
        makeMemoryPlugin(adapter),
      ] as unknown as import("../src/types/agent.js").AgentOptions["plugins"],
    });
    try {
      expect(initCount).toBe(0); // not initialized yet — lazy
      await agent.memory!.write("a", { userId: "demo" });
      expect(initCount).toBe(1);
      await agent.memory!.write("b", { userId: "demo" });
      await agent.memory!.recall("q", { userId: "demo" });
      expect(initCount).toBe(1); // idempotent
    } finally {
      await agent.dispose();
    }
  });
});
