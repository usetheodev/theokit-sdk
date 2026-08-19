import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type EvictReason,
  LiveAgentRegistry,
} from "../../../src/internal/runtime/registry/live-agent-registry.js";
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

  it("forget(id) removes from cache without calling dispose (dispose-cache fix)", async () => {
    const agent = stubAgent("a");
    reg.set("a", agent);
    expect(reg.get("a")).toBe(agent);
    reg.forget("a");
    expect(reg.get("a")).toBeUndefined();
    // dispose was NEVER called by forget — only by an explicit evict/evictAll.
    expect((agent.dispose as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
  });

  it("forget(id) is idempotent for unknown ids", () => {
    expect(() => reg.forget("never-cached")).not.toThrow();
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
    // B-018. Recency here is `lastUsedAt`, written from `Date.now()` (live-agent-registry.ts:95,
    // :117). The 5ms sleeps existed to make those timestamps differ — which works until two `set`
    // calls land inside the same millisecond under full-suite load. Then the timestamps tie, the
    // eviction falls back to Map insertion order, and the test passes or fails for a reason that has
    // nothing to do with the code.
    //
    // The clock IS the input to this behaviour, so it belongs under test control rather than being
    // waited on. Measured: this test already fails when the LRU comparison is reversed, so what
    // changes is determinism, not coverage.
    vi.useFakeTimers();
    try {
      reg.configure({ maxAgents: 3 });
      const aDispose = vi.fn().mockResolvedValue(undefined);
      const a = { ...stubAgent("a"), dispose: aDispose } as unknown as SDKAgent;

      vi.setSystemTime(1_000);
      reg.set("a", a);
      vi.setSystemTime(2_000);
      reg.set("b", stubAgent("b"));
      vi.setSystemTime(3_000);
      reg.set("c", stubAgent("c"));
      vi.setSystemTime(4_000);
      reg.set("d", stubAgent("d")); // exceeds — evicts a (oldest)

      // `set` does not await `#evictLRU` (it is off the hot path), so let its promise settle.
      await vi.advanceTimersByTimeAsync(0);

      expect(reg.ids(), "the least-recently-used entry must be the one evicted").not.toContain("a");
      expect(aDispose, "and the evicted agent must be disposed").toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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
    // B-017, second half. Same file, same defect: a 50ms sleep standing in for "a sweep cycle
    // happened and did nothing". With a 1000ms interval it never waited for one — the test proved
    // only that nothing evicted within 50ms, which is also true if the sweep is broken. Advancing
    // past two full ticks is the claim the name makes.
    //
    // Worth recording about the PRODUCT, not this test: `idleTimeoutMs: 0` is guarded twice
    // independently — `:85` never arms the interval, and `:197` returns early if it somehow runs. No
    // single mutation of either can fail this test; removing BOTH does (measured). That is defence
    // in depth working as intended, not a weak oracle, and it is why a mutation score on this file
    // will report a survivor that is not a gap.
    vi.useFakeTimers();
    try {
      reg.configure({ maxAgents: 10, idleTimeoutMs: 0, sweepIntervalMs: 1000 });
      reg.set("a", stubAgent("a"));

      await vi.advanceTimersByTimeAsync(2_500);

      expect(reg.ids(), "idleTimeoutMs: 0 must disable idle eviction entirely").toContain("a");
    } finally {
      vi.useRealTimers();
    }
  });

  it("idle sweep evicts after timeout elapsed", async () => {
    // B-017. The sweep runs on `setInterval` (live-agent-registry.ts:215) and the idle threshold is
    // `Date.now() - idleTimeoutMs`. Both are inputs to the behaviour, so both belong under test
    // control — the 1100ms sleep was a 100ms margin over a 1000ms interval, and a 100ms margin is
    // not a margin on a loaded machine. It also made this the slowest test in the file by an order
    // of magnitude, for no coverage: measured, the test already fails when the sweep stops evicting.
    vi.useFakeTimers();
    try {
      const onEvict = vi.fn();
      reg.configure({
        maxAgents: 10,
        idleTimeoutMs: 30,
        sweepIntervalMs: 1000,
        onEvict,
      });
      reg.set("a", stubAgent("a"));

      // Past the idle threshold, then past one sweep tick. `advanceTimersByTimeAsync` also drains
      // the promise the interval callback returns, which a synchronous advance would not.
      await vi.advanceTimersByTimeAsync(1_100);

      expect(reg.ids(), "an idle entry must be swept").not.toContain("a");
      expect(onEvict, "and the eviction must report its reason").toHaveBeenCalledWith("a", "idle");
    } finally {
      vi.useRealTimers();
    }
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
