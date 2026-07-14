import { describe, expect, it } from "vitest";

import { runActiveMemory } from "../src/internal/active-memory/active-memory.js";
import { ActiveMemoryCache } from "../src/internal/active-memory/active-memory-cache.js";
import type { MemoryIndex } from "../src/internal/index/memory-index.js";

/**
 * #56 (GAP-B) — cross-tenant active-recall cache leak in the PUBLISHABLE
 * `@theokit/sdk-memory` copy.
 *
 * The cache primitive supports a tenantCtx tuple, but `runActiveMemory` here
 * called `cache.get/set` WITHOUT threading `{namespace,userId,scope}` — so two
 * callers with the SAME query text but DIFFERENT identity shared a cache entry
 * (the exact pre-fix #56 bug, still present in this copy).
 *
 * RED (pre-fix): tenant B is served from tenant A's cached recall → `calls === 1`.
 */
describe("sdk-memory active-memory cross-tenant cache isolation (#56-B)", () => {
  const opts = { enabled: true, queryMode: "message" as const };

  const countingIndex = (counter: { n: number }): MemoryIndex =>
    ({
      search: () => {
        counter.n += 1;
        return Promise.resolve([]);
      },
    }) as unknown as MemoryIndex;

  it("does not serve one tenant's cached recall to another tenant with the same query", async () => {
    const counter = { n: 0 };
    const index = countingIndex(counter);
    const cache = new ActiveMemoryCache();

    await runActiveMemory({
      userText: "same-query",
      priorMessages: [],
      index,
      options: opts,
      cache,
      userId: "user-A",
      namespace: "org-A",
      scope: "session",
    });
    await runActiveMemory({
      userText: "same-query",
      priorMessages: [],
      index,
      options: opts,
      cache,
      userId: "user-B",
      namespace: "org-B",
      scope: "session",
    });

    // Leak → B served from A → n === 1. Isolated → n === 2.
    expect(counter.n).toBe(2);
  });

  it("still serves a cache hit to the SAME tenant+query (no over-keying)", async () => {
    const counter = { n: 0 };
    const index = countingIndex(counter);
    const cache = new ActiveMemoryCache();
    const identity = { userId: "user-A", namespace: "org-A", scope: "session" } as const;

    await runActiveMemory({ userText: "q", priorMessages: [], index, options: opts, cache, ...identity });
    await runActiveMemory({ userText: "q", priorMessages: [], index, options: opts, cache, ...identity });

    expect(counter.n).toBe(1);
  });
});
