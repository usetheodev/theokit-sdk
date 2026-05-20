/**
 * Tests for check-fn-cache (T2.3, ADR D103).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetCheckFnCache,
  getAvailableTools,
  isToolAvailable,
} from "../../../src/internal/tool-registry/check-fn-cache.js";
import type { ToolEntry } from "../../../src/internal/tool-registry/registry.js";

function entry(overrides: Partial<ToolEntry> = {}): ToolEntry {
  return {
    name: `t-${Math.random().toString(36).slice(2, 10)}`,
    description: "",
    inputSchema: {},
    handler: () => "",
    ...overrides,
  };
}

beforeEach(() => {
  _resetCheckFnCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("check-fn-cache (T2.3)", () => {
  it("available when no checkFn nor requiresEnv", async () => {
    expect(await isToolAvailable(entry())).toBe(true);
  });

  it("unavailable when requiresEnv missing", async () => {
    vi.stubEnv("FOO_KEY", "");
    expect(await isToolAvailable(entry({ requiresEnv: ["FOO_KEY"] }))).toBe(false);
  });

  it("available when requiresEnv present", async () => {
    vi.stubEnv("FOO_KEY", "set");
    expect(await isToolAvailable(entry({ requiresEnv: ["FOO_KEY"] }))).toBe(true);
  });

  it("checkFn called once within TTL", async () => {
    const fn = vi.fn().mockReturnValue(true);
    const e = entry({ checkFn: fn, name: "ttl-test-1" });
    await isToolAvailable(e);
    await isToolAvailable(e);
    await isToolAvailable(e);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("checkFn called again after TTL", async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockReturnValue(true);
    const e = entry({ checkFn: fn, name: "ttl-test-2" });
    await isToolAvailable(e);
    vi.advanceTimersByTime(31_000);
    await isToolAvailable(e);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("checkFn throw treated as unavailable + cached", async () => {
    const fn = vi.fn(() => {
      throw new Error("probe failed");
    });
    const e = entry({ checkFn: fn, name: "throw-test" });
    expect(await isToolAvailable(e)).toBe(false);
    expect(await isToolAvailable(e)).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("getAvailableTools filters out unavailable", async () => {
    vi.stubEnv("YES_KEY", "x");
    vi.stubEnv("NO_KEY", "");
    const ok = entry({ name: "ok", requiresEnv: ["YES_KEY"] });
    const bad = entry({ name: "bad", requiresEnv: ["NO_KEY"] });
    const out = await getAvailableTools([ok, bad]);
    expect(out.map((e) => e.name)).toEqual(["ok"]);
  });

  it("reset clears cache", async () => {
    const fn = vi.fn().mockReturnValue(true);
    const e = entry({ checkFn: fn, name: "reset-test" });
    await isToolAvailable(e);
    _resetCheckFnCache();
    await isToolAvailable(e);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("EC-8: concurrent Promise.all is idempotent (1-N invocations, consistent result)", async () => {
    let count = 0;
    const fn = vi.fn(async () => {
      count++;
      await new Promise((r) => setTimeout(r, 5));
      return true;
    });
    const e = entry({ checkFn: fn, name: "concurrent-test" });
    const results = await Promise.all([isToolAvailable(e), isToolAvailable(e), isToolAvailable(e)]);
    expect(results).toEqual([true, true, true]);
    // Each concurrent call may have invoked checkFn (no inflight dedup); but
    // the cache stabilizes with one result. Both behaviors acceptable.
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(3);
  });
});
