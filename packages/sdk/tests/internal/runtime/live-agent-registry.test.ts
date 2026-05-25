import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type EvictReason,
  LiveAgentRegistry,
} from "../../../src/internal/runtime/live-agent-registry.js";
import type { SDKAgent } from "../../../src/types/agent.js";

/**
 * Minimal SDKAgent stub for cache testing. Only `dispose` is exercised by
 * eviction paths; other methods throw to surface accidental real usage.
 */
function stubAgent(id: string): SDKAgent {
  const disposeSpy = vi.fn().mockResolvedValue(undefined);
  return {
    agentId: id,
    model: undefined,
    send: async () => {
      throw new Error("not used in cache tests");
    },
    close: () => {},
    reload: async () => {},
    dispose: disposeSpy,
    [Symbol.asyncDispose]: disposeSpy,
    listArtifacts: async () => [],
    downloadArtifact: async () => Buffer.alloc(0),
  } as unknown as SDKAgent;
}

describe("LiveAgentRegistry — core (T2.1)", () => {
  let reg: LiveAgentRegistry;

  beforeEach(() => {
    reg = new LiveAgentRegistry();
  });

  afterEach(async () => {
    await reg.evictAll();
  });

  it("set + get returns the same agent", () => {
    const agent = stubAgent("a");
    reg.set("a", agent);
    expect(reg.get("a")).toBe(agent);
  });

  it("get unknown returns undefined (not throw)", () => {
    expect(reg.get("missing")).toBeUndefined();
  });

  it("size reflects set count", () => {
    reg.configure({ maxAgents: 10 });
    reg.set("a", stubAgent("a"));
    reg.set("b", stubAgent("b"));
    reg.set("c", stubAgent("c"));
    expect(reg.size()).toBe(3);
  });

  it("ids returns entries in recency order (newest first)", async () => {
    reg.configure({ maxAgents: 10 });
    reg.set("a", stubAgent("a"));
    await new Promise((r) => setTimeout(r, 5));
    reg.set("b", stubAgent("b"));
    await new Promise((r) => setTimeout(r, 5));
    reg.set("c", stubAgent("c"));
    expect(reg.ids()).toEqual(["c", "b", "a"]);
  });

  it("get refreshes lastUsedAt, moving entry to top of recency", async () => {
    reg.configure({ maxAgents: 10 });
    reg.set("a", stubAgent("a"));
    await new Promise((r) => setTimeout(r, 5));
    reg.set("b", stubAgent("b"));
    await new Promise((r) => setTimeout(r, 5));
    reg.get("a"); // refresh
    expect(reg.ids()[0]).toBe("a");
  });
});

describe("LiveAgentRegistry — LRU eviction (T2.2)", () => {
  let reg: LiveAgentRegistry;

  beforeEach(() => {
    reg = new LiveAgentRegistry();
  });

  afterEach(async () => {
    await reg.evictAll();
  });

  it("evicts least-recently-used when maxAgents exceeded", async () => {
    reg.configure({ maxAgents: 3 });
    const aDispose = vi.fn().mockResolvedValue(undefined);
    const a = { ...stubAgent("a"), dispose: aDispose } as unknown as SDKAgent;
    reg.set("a", a);
    await new Promise((r) => setTimeout(r, 5));
    reg.set("b", stubAgent("b"));
    await new Promise((r) => setTimeout(r, 5));
    reg.set("c", stubAgent("c"));
    await new Promise((r) => setTimeout(r, 5));
    reg.set("d", stubAgent("d")); // exceeds — evicts a (oldest)
    await new Promise((r) => setTimeout(r, 20));
    expect(reg.ids()).not.toContain("a");
    expect(aDispose).toHaveBeenCalled();
  });

  it("refreshing usage saves an agent from LRU eviction", async () => {
    reg.configure({ maxAgents: 3 });
    reg.set("a", stubAgent("a"));
    await new Promise((r) => setTimeout(r, 5));
    reg.set("b", stubAgent("b"));
    await new Promise((r) => setTimeout(r, 5));
    reg.set("c", stubAgent("c"));
    await new Promise((r) => setTimeout(r, 5));
    reg.get("a"); // refresh — a is no longer LRU
    reg.set("d", stubAgent("d"));
    await new Promise((r) => setTimeout(r, 20));
    expect(reg.ids()).toContain("a");
    expect(reg.ids()).not.toContain("b"); // b was oldest
  });

  it("set with same id different agent disposes the old (EC-4)", async () => {
    reg.configure({ maxAgents: 10 });
    const oldDispose = vi.fn().mockResolvedValue(undefined);
    const oldAgent = { ...stubAgent("a"), dispose: oldDispose } as unknown as SDKAgent;
    reg.set("a", oldAgent);
    const newAgent = stubAgent("a");
    reg.set("a", newAgent);
    await new Promise((r) => setTimeout(r, 20));
    expect(oldDispose).toHaveBeenCalled();
    expect(reg.get("a")).toBe(newAgent);
  });

  it("set with same id same agent does NOT dispose (EC-4 idempotent)", async () => {
    reg.configure({ maxAgents: 10 });
    const dispose = vi.fn().mockResolvedValue(undefined);
    const agent = { ...stubAgent("a"), dispose } as unknown as SDKAgent;
    reg.set("a", agent);
    reg.set("a", agent); // same instance
    await new Promise((r) => setTimeout(r, 20));
    expect(dispose).not.toHaveBeenCalled();
  });

  it("dispose error swallowed with stderr warn", async () => {
    reg.configure({ maxAgents: 1 });
    const bad = {
      ...stubAgent("bad"),
      dispose: vi.fn().mockRejectedValue(new Error("dispose nope")),
    } as unknown as SDKAgent;
    reg.set("bad", bad);
    reg.set("ok", stubAgent("ok")); // triggers eviction of "bad"
    await new Promise((r) => setTimeout(r, 30));
    // No throw — eviction continued.
    expect(reg.ids()).toContain("ok");
  });
});

describe("LiveAgentRegistry — idle timeout (T2.3)", () => {
  let reg: LiveAgentRegistry;

  beforeEach(() => {
    reg = new LiveAgentRegistry();
  });

  afterEach(async () => {
    await reg.evictAll();
  });

  it("idle eviction disabled when idleTimeoutMs is 0", async () => {
    reg.configure({ maxAgents: 10, idleTimeoutMs: 0, sweepIntervalMs: 1000 });
    reg.set("a", stubAgent("a"));
    await new Promise((r) => setTimeout(r, 50));
    expect(reg.ids()).toContain("a");
  });

  it("idle sweep evicts after timeout elapsed", async () => {
    const onEvict = vi.fn();
    reg.configure({
      maxAgents: 10,
      idleTimeoutMs: 30, // 30ms
      sweepIntervalMs: 1000, // fast sweep
      onEvict,
    });
    reg.set("a", stubAgent("a"));
    // Wait > idle + sweep cycle (1000ms minimum).
    await new Promise((r) => setTimeout(r, 1100));
    expect(reg.ids()).not.toContain("a");
    expect(onEvict).toHaveBeenCalledWith("a", "idle");
  });
});

describe("LiveAgentRegistry — onEvict (T2.4)", () => {
  let reg: LiveAgentRegistry;

  beforeEach(() => {
    reg = new LiveAgentRegistry();
  });

  afterEach(async () => {
    await reg.evictAll();
  });

  it("onEvict fires with reason=explicit", async () => {
    const calls: Array<[string, EvictReason]> = [];
    reg.configure({ maxAgents: 10, onEvict: (id, r) => calls.push([id, r]) });
    reg.set("a", stubAgent("a"));
    await reg.evict("a");
    expect(calls).toEqual([["a", "explicit"]]);
  });

  it("onEvict fires with reason=lru on capacity overflow", async () => {
    const calls: Array<[string, EvictReason]> = [];
    reg.configure({ maxAgents: 1, onEvict: (id, r) => calls.push([id, r]) });
    reg.set("a", stubAgent("a"));
    await new Promise((r) => setTimeout(r, 5));
    reg.set("b", stubAgent("b"));
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toEqual([["a", "lru"]]);
  });

  it("onEvict listener errors are swallowed", async () => {
    reg.configure({
      maxAgents: 10,
      onEvict: () => {
        throw new Error("listener kaboom");
      },
    });
    reg.set("a", stubAgent("a"));
    await expect(reg.evict("a")).resolves.toBe(true);
  });
});

describe("LiveAgentRegistry — maxAgents zero (cache disabled)", () => {
  let reg: LiveAgentRegistry;

  beforeEach(() => {
    reg = new LiveAgentRegistry();
  });

  afterEach(async () => {
    await reg.evictAll();
  });

  it("set is no-op when maxAgents is 0", () => {
    reg.configure({ maxAgents: 0 });
    reg.set("a", stubAgent("a"));
    expect(reg.size()).toBe(0);
    expect(reg.get("a")).toBeUndefined();
  });
});
