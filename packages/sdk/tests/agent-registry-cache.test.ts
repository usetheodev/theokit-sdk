/**
 * Agent.registry public surface + getOrCreate cache integration (Production-Readiness #2).
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Agent } from "../src/agent.js";
import {
  clearAgentRegistry,
  invalidateRegistryHydration,
} from "../src/internal/runtime/agent-registry.js";
import { clearAllSessions } from "../src/internal/runtime/agent-session.js";

const FIXTURE_KEY = "theo_test_registry_cache";
const MODEL = { id: "openai/gpt-4o-mini" };

describe("Agent.registry — public surface (T2.5)", () => {
  beforeEach(async () => {
    await Agent.registry.evictAll();
    Agent.registry.configure({ maxAgents: 100, idleTimeoutMs: 30 * 60_000 });
  });

  afterEach(async () => {
    await Agent.registry.evictAll();
  });

  it("Agent.registry is accessible as a static readonly", () => {
    expect(Agent.registry).toBeDefined();
    expect(typeof Agent.registry.configure).toBe("function");
    expect(typeof Agent.registry.evict).toBe("function");
    expect(typeof Agent.registry.evictAll).toBe("function");
    expect(typeof Agent.registry.size).toBe("function");
    expect(typeof Agent.registry.ids).toBe("function");
  });

  it("configure changes maxAgents", () => {
    Agent.registry.configure({ maxAgents: 5 });
    expect(Agent.registry.size()).toBe(0); // no entries yet
  });
});

describe("Agent.getOrCreate — cache integration (T2.6)", () => {
  let root: string;

  beforeEach(async () => {
    clearAgentRegistry();
    clearAllSessions();
    invalidateRegistryHydration();
    await Agent.registry.evictAll();
    Agent.registry.configure({ maxAgents: 100 });
    root = await mkdtemp(join(tmpdir(), "theokit-cache-"));
  });

  afterEach(async () => {
    clearAgentRegistry();
    clearAllSessions();
    invalidateRegistryHydration();
    await Agent.registry.evictAll();
    await rm(root, { recursive: true, force: true });
  });

  it("second call hits cache (no re-initialization)", async () => {
    const first = await Agent.getOrCreate("agent-cache-hit", {
      apiKey: FIXTURE_KEY,
      model: MODEL,
      local: { cwd: root },
    });
    const second = await Agent.getOrCreate("agent-cache-hit", {
      apiKey: FIXTURE_KEY,
      model: MODEL,
      local: { cwd: root },
    });
    expect(second).toBe(first);
    expect(Agent.registry.size()).toBe(1);
  });

  it("evict forces re-hydration on next getOrCreate", async () => {
    const first = await Agent.getOrCreate("agent-evict-reload", {
      apiKey: FIXTURE_KEY,
      model: MODEL,
      local: { cwd: root },
    });
    await Agent.registry.evict("agent-evict-reload");
    const second = await Agent.getOrCreate("agent-evict-reload", {
      apiKey: FIXTURE_KEY,
      model: MODEL,
      local: { cwd: root },
    });
    expect(second).not.toBe(first);
  });

  it("maxAgents=0 disables the cache (always re-initializes)", async () => {
    Agent.registry.configure({ maxAgents: 0 });
    const first = await Agent.getOrCreate("agent-no-cache", {
      apiKey: FIXTURE_KEY,
      model: MODEL,
      local: { cwd: root },
    });
    expect(Agent.registry.size()).toBe(0);
    const second = await Agent.getOrCreate("agent-no-cache", {
      apiKey: FIXTURE_KEY,
      model: MODEL,
      local: { cwd: root },
    });
    expect(second).not.toBe(first);
  });

  it("onEvict listener fires when LRU drops an agent", async () => {
    const evicted: string[] = [];
    Agent.registry.configure({
      maxAgents: 1,
      onEvict: (id) => evicted.push(id),
    });
    await Agent.getOrCreate("agent-a", {
      apiKey: FIXTURE_KEY,
      model: MODEL,
      local: { cwd: root },
    });
    await new Promise((r) => setTimeout(r, 5));
    await Agent.getOrCreate("agent-b", {
      apiKey: FIXTURE_KEY,
      model: MODEL,
      local: { cwd: root },
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(evicted).toContain("agent-a");
  });
});
