/**
 * sdk-memory `ActiveMemoryCache` unit test (iter 51).
 *
 * Validates the iter 51 hybrid copy of `internal/memory/active-memory-cache.ts`
 * from sdk-core. sdk-memory now ships the canonical TTL+capacity LRU
 * cache that the future `active-memory.ts` move will target as a
 * sibling.
 *
 * sdk-core retains its copy for v1.x active-memory back-compat.
 * Both copies are byte-identical today; semver-major reconciliation
 * happens when Stage 3 source-move completes.
 *
 * Covers (mirrors sdk-core's existing active-memory-cache tests but
 * uses the sdk-memory public surface):
 *   - hit before TTL → cache returns the original result
 *   - miss after TTL → cache evicts + returns undefined
 *   - capacity overflow → oldest entry evicted FIFO
 *   - distinct (userText, queryMode) keys → independent cache slots
 *   - LRU bump → most-recent-get is preserved during capacity overflow
 */

import {
  ActiveMemoryCache,
  type ActiveMemoryCacheOptions,
  type ActiveMemoryResult,
} from "@theokit/sdk-memory";
import { describe, expect, it } from "vitest";

function fakeResult(summary: string): ActiveMemoryResult {
  return {
    summary,
    durationMs: 5,
    status: "ok",
    hits: [],
  };
}

describe("sdk-memory ActiveMemoryCache (iter 51)", () => {
  it("test_get_returns_set_value_before_ttl", () => {
    const cache = new ActiveMemoryCache();
    cache.set("hello", "message", fakeResult("first"));
    const hit = cache.get("hello", "message");
    expect(hit?.summary).toBe("first");
  });

  it("test_get_returns_undefined_after_ttl_expires", () => {
    let now = 0;
    const opts: ActiveMemoryCacheOptions = { ttlMs: 100, now: () => now };
    const cache = new ActiveMemoryCache(opts);
    cache.set("hello", "message", fakeResult("first"));
    now = 50;
    expect(cache.get("hello", "message")?.summary).toBe("first");
    now = 150; // past TTL boundary
    expect(cache.get("hello", "message")).toBeUndefined();
  });

  it("test_distinct_queryMode_keys_are_independent", () => {
    const cache = new ActiveMemoryCache();
    cache.set("same text", "message", fakeResult("m-result"));
    cache.set("same text", "recent", fakeResult("r-result"));
    expect(cache.get("same text", "message")?.summary).toBe("m-result");
    expect(cache.get("same text", "recent")?.summary).toBe("r-result");
  });

  it("test_capacity_overflow_evicts_oldest_FIFO", () => {
    const cache = new ActiveMemoryCache({ capacity: 2 });
    cache.set("a", "message", fakeResult("a"));
    cache.set("b", "message", fakeResult("b"));
    cache.set("c", "message", fakeResult("c")); // evicts "a" (oldest insert)
    expect(cache.size()).toBe(2);
    expect(cache.get("a", "message")).toBeUndefined();
    expect(cache.get("b", "message")?.summary).toBe("b");
    expect(cache.get("c", "message")?.summary).toBe("c");
  });

  it("test_LRU_bump_promotes_most_recent_get", () => {
    const cache = new ActiveMemoryCache({ capacity: 2 });
    cache.set("a", "message", fakeResult("a"));
    cache.set("b", "message", fakeResult("b"));
    // Touching "a" promotes it to most-recent; next set evicts "b" (now LRU).
    expect(cache.get("a", "message")?.summary).toBe("a");
    cache.set("c", "message", fakeResult("c"));
    expect(cache.get("b", "message")).toBeUndefined();
    expect(cache.get("a", "message")?.summary).toBe("a");
    expect(cache.get("c", "message")?.summary).toBe("c");
  });

  it("test_size_reports_actual_entries_after_set_and_eviction", () => {
    const cache = new ActiveMemoryCache({ capacity: 3 });
    expect(cache.size()).toBe(0);
    cache.set("a", "message", fakeResult("a"));
    expect(cache.size()).toBe(1);
    cache.set("b", "message", fakeResult("b"));
    cache.set("c", "message", fakeResult("c"));
    cache.set("d", "message", fakeResult("d")); // evicts "a"
    expect(cache.size()).toBe(3);
  });
});
