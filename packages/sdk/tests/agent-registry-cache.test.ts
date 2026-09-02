/**
 * Agent.registry public surface + getOrCreate cache integration (Production-Readiness #2).
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

// The isolation this file needs is real and is already in place, but not where this comment used to
// point. A five-line note here announced that it would "force serial execution within this file's
// describes", and no control followed it — nothing was forced. The hazard it named is also gone:
// vitest's forks pool gives each FILE its own process, so `Agent.registry` cannot be stomped by
// another file. What isolates the cases inside this one is `evictAll` in both hooks plus a unique id
// per test, which is code rather than prose.

import { Agent } from "../src/agent.js";
import {
  clearAgentRegistry,
  flushRegistrySaves,
  invalidateRegistryHydration,
} from "../src/internal/runtime/registry/agent-registry.js";
import { clearAllSessions } from "../src/internal/session/agent-session.js";
import { pollUntil } from "./helpers/poll-until.js";

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
    // Reset to defaults explicitly so a prior test that set onEvict listeners
    // or extreme maxAgents/idleTimeoutMs does not leak into this test.
    Agent.registry.configure({
      maxAgents: 100,
      idleTimeoutMs: 30 * 60 * 1000,
      sweepIntervalMs: 60_000,
    });
    root = await mkdtemp(join(tmpdir(), "theokit-cache-"));
  });

  afterEach(async () => {
    clearAgentRegistry();
    clearAllSessions();
    invalidateRegistryHydration();
    await Agent.registry.evictAll();
    // EC-flake: wait for any in-flight registry persistence to complete
    // before removing the tmp dir, otherwise `rm` races the atomic-write
    // rename and ENOTEMPTYs.
    await flushRegistrySaves();
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

  it("dispose() self-evicts so next getOrCreate returns a fresh agent (dispose-cache fix)", async () => {
    // Reproduces the telegram-pro 2026-05-28 dogfood bug: handler calls
    // `agent.dispose()`, next handler calls `Agent.getOrCreate(sameId)` and
    // used to receive the DISPOSED instance — subsequent `send()` threw
    // "Agent has been disposed". The fix evicts the cache entry inside
    // `LocalAgent.dispose()` via `liveAgentRegistry.forget(this.agentId)`.
    const first = await Agent.getOrCreate("agent-self-evict-on-dispose", {
      apiKey: FIXTURE_KEY,
      model: MODEL,
      local: { cwd: root },
    });
    expect(Agent.registry.size()).toBe(1);
    await first.dispose();
    expect(Agent.registry.size()).toBe(0);
    const second = await Agent.getOrCreate("agent-self-evict-on-dispose", {
      apiKey: FIXTURE_KEY,
      model: MODEL,
      local: { cwd: root },
    });
    expect(second).not.toBe(first);
  });

  it("maxAgents=0 disables the cache (always re-initializes)", async () => {
    Agent.registry.configure({ maxAgents: 0 });
    // Use unique id per test invocation so a parallel-test interleaving cannot
    // pre-populate the agent metadata registry with our id.
    const uniqueId = `agent-no-cache-${Math.random().toString(36).slice(2, 10)}`;
    const first = await Agent.getOrCreate(uniqueId, {
      apiKey: FIXTURE_KEY,
      model: MODEL,
      local: { cwd: root },
    });
    expect(Agent.registry.size()).toBe(0);
    const second = await Agent.getOrCreate(uniqueId, {
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
    const aid = `agent-a-${Math.random().toString(36).slice(2, 10)}`;
    const bid = `agent-b-${Math.random().toString(36).slice(2, 10)}`;
    await Agent.getOrCreate(aid, {
      apiKey: FIXTURE_KEY,
      model: MODEL,
      local: { cwd: root },
    });
    await new Promise((r) => setTimeout(r, 10));
    await Agent.getOrCreate(bid, {
      apiKey: FIXTURE_KEY,
      model: MODEL,
      local: { cwd: root },
    });
    // M77 — it was `await new Promise((r) => setTimeout(r, 100))`: a FIXED wait for an eviction
    // asynchronous. It passed alone and failed under the full suite's load (observed 1 in 3),
    // because 100 ms stops being enough when the machine is busy. `rules/testing.md` § 6 lists
    // time in a unit test as an anti-pattern, and § 3 treats a flake as a bug.
    //
    // Raising the number only moves the threshold. Waiting for the CONDITION with a deadline removes the
    // timing assumption without weakening the assertion: the test still requires `aid` to be evicted, and fails
    // the same way if that never happens.
    //
    // B-056: this inline loop was the proof-of-concept; `pollUntil` (tests/helpers/poll-until.ts)
    // is the same loop extracted into a shared util so other sleep-as-sync sites can adopt it.
    await pollUntil(() => evicted.includes(aid), {
      deadlineMs: 5_000,
      message: `agent-registry-cache: "${aid}" was never evicted within 5s`,
    });
    expect(evicted).toContain(aid);
  });
});
