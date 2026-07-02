import { describe, expect, it } from "vitest";
import { runActiveMemory } from "../../src/internal/memory/active-memory.js";
import { ActiveMemoryCache } from "../../src/internal/memory/active-memory-cache.js";
import type { IndexManager } from "../../src/internal/memory/index-manager.js";

/**
 * #56 — cross-tenant active-recall cache leak.
 *
 * The cache key infra (`active-memory-cache.ts`) already supports a tenantCtx
 * tuple, but `runActiveMemory` did not thread `{namespace,userId,scope}` into
 * `cache.get/set`, so two callers with the SAME query text but DIFFERENT
 * identity shared a cache entry — a cross-tenant data leak.
 *
 * RED (pre-fix): the isolation test observes `calls === 1` (tenant B served
 * from tenant A's cached recall) and fails `expect(2)`.
 */
describe("active-memory cross-tenant cache isolation (#56)", () => {
  const opts = { enabled: true, queryMode: "message" as const };

  it("does not serve one tenant's cached recall to another tenant with the same query", async () => {
    let calls = 0;
    const index = {
      search: () => {
        calls += 1;
        return Promise.resolve([]);
      },
    } as unknown as IndexManager;
    const cache = new ActiveMemoryCache();

    // Tenant A caches its (empty) recall for "same-query".
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
    // Tenant B — identical query text, different identity — MUST NOT hit A's entry.
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

    // Leak → B served from A's cache → calls === 1. Isolated → calls === 2.
    expect(calls).toBe(2);
  });

  it("still serves a cache hit to the SAME tenant+query (no over-keying)", async () => {
    let calls = 0;
    const index = {
      search: () => {
        calls += 1;
        return Promise.resolve([]);
      },
    } as unknown as IndexManager;
    const cache = new ActiveMemoryCache();
    const identity = { userId: "user-A", namespace: "org-A", scope: "session" } as const;

    await runActiveMemory({
      userText: "q",
      priorMessages: [],
      index,
      options: opts,
      cache,
      ...identity,
    });
    await runActiveMemory({
      userText: "q",
      priorMessages: [],
      index,
      options: opts,
      cache,
      ...identity,
    });

    // Same identity + query → cache hit preserved.
    expect(calls).toBe(1);
  });
});
