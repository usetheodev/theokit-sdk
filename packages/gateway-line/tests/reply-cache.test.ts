import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReplyTokenCache } from "../src/reply-cache.js";

describe("ReplyTokenCache (D407)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("put + take returns the stored token", () => {
    const cache = new ReplyTokenCache();
    cache.put("u-1", "tok-1");
    expect(cache.take("u-1")).toBe("tok-1");
  });

  it("take is one-shot — second consume returns undefined", () => {
    const cache = new ReplyTokenCache();
    cache.put("u-1", "tok-1");
    expect(cache.take("u-1")).toBe("tok-1");
    expect(cache.take("u-1")).toBeUndefined();
  });

  it("expires after TTL (default 60s)", () => {
    const cache = new ReplyTokenCache();
    cache.put("u-1", "tok-1");
    vi.advanceTimersByTime(61_000);
    expect(cache.take("u-1")).toBeUndefined();
  });

  it("returns fresh token within TTL", () => {
    const cache = new ReplyTokenCache();
    cache.put("u-1", "tok-1");
    vi.advanceTimersByTime(30_000);
    expect(cache.take("u-1")).toBe("tok-1");
  });

  it("evicts oldest when capacity reached", () => {
    const cache = new ReplyTokenCache({ capacity: 2 });
    cache.put("u-1", "tok-1");
    cache.put("u-2", "tok-2");
    cache.put("u-3", "tok-3"); // evicts u-1
    expect(cache.take("u-1")).toBeUndefined();
    expect(cache.take("u-2")).toBe("tok-2");
    expect(cache.take("u-3")).toBe("tok-3");
  });

  it("clear() empties the cache", () => {
    const cache = new ReplyTokenCache();
    cache.put("u-1", "tok-1");
    cache.put("u-2", "tok-2");
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.take("u-1")).toBeUndefined();
  });
});
