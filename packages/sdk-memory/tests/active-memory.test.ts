/**
 * sdk-memory `active-memory` unit test (iter 75).
 *
 * Validates the iter 75 hybrid copy of `internal/memory/active-memory.ts`
 * from sdk-core. **CLOSES Stage 3 source-move** in sdk-memory.
 *
 * sdk-core retains its copy for v1.x runtime back-compat.
 * Both copies byte-equivalent at runtime (same DEFAULTS=
 * {queryMode:"recent", timeoutMs:15000, maxSummaryChars:220,
 * recentUserTurns:2}, same skipped/no-recall/timeout/error/ok status
 * matrix, same buildQuery semantics per queryMode literal, same
 * formatSummary ellipsis truncation, same circuit-breaker notify
 * mapping on timeout/ok/no-recall).
 *
 * Tests skip telemetry side-effects (no opentelemetry installed) and
 * focus on the pure orchestration math: skip gates, query construction
 * per mode, summary formatting, circuit-breaker integration.
 */

import {
  type ActiveMemoryCache,
  type ActiveMemoryOptions,
  type ActiveMemoryResult,
  type MemoryIndex,
  type MemorySearchHit,
  type RunActiveMemoryArgs,
  runActiveMemory,
} from "@theokit/sdk-memory";
import { describe, expect, it } from "vitest";

function stubIndex(hits: ReadonlyArray<MemorySearchHit>): MemoryIndex {
  return {
    sync: async () => ({
      filesScanned: 0,
      filesUpdated: 0,
      chunksWritten: 0,
      chunksEmbedded: 0,
    }),
    search: async () => [...hits],
    status: () =>
      ({
        backend: "fts-only",
        filesIndexed: 0,
        chunksIndexed: 0,
      }) as never,
    close: () => undefined,
  };
}

function hitOf(citation: string, snippet: string, score = 0.9): MemorySearchHit {
  return {
    path: "MEMORY.md",
    startLine: 1,
    endLine: 5,
    score,
    textScore: score,
    snippet,
    source: "memory",
    citation,
  };
}

function buildArgs(overrides: Partial<RunActiveMemoryArgs> = {}): RunActiveMemoryArgs {
  return {
    userText: "hello world",
    priorMessages: [],
    index: stubIndex([hitOf("MEMORY.md:1-5", "coffee preference")]),
    options: { enabled: true },
    ...overrides,
  };
}

describe("sdk-memory active-memory (iter 75)", () => {
  describe("skip gates", () => {
    it("test_status_skipped_when_enabled_false", async () => {
      const result: ActiveMemoryResult = await runActiveMemory(
        buildArgs({ options: { enabled: false } }),
      );
      expect(result.status).toBe("skipped");
      expect(result.hits).toEqual([]);
      expect(result.summary).toBeUndefined();
    });

    it("test_status_skipped_when_index_undefined", async () => {
      const result = await runActiveMemory(
        buildArgs({ index: undefined, options: { enabled: true } }),
      );
      expect(result.status).toBe("skipped");
    });

    it("test_status_skipped_when_breaker_should_skip", async () => {
      const args = buildArgs({
        breaker: {
          shouldSkip: () => true,
          recordSuccess: () => {},
          recordTimeout: () => {},
        } as never,
      });
      const result = await runActiveMemory(args);
      expect(result.status).toBe("skipped");
    });
  });

  describe("happy path", () => {
    it("test_status_ok_summary_includes_citation_and_snippet", async () => {
      const result = await runActiveMemory(buildArgs());
      expect(result.status).toBe("ok");
      expect(result.hits.length).toBe(1);
      expect(result.summary).toContain("MEMORY.md:1-5");
      expect(result.summary).toContain("coffee preference");
    });

    it("test_summary_truncated_with_ellipsis_when_above_maxSummaryChars", async () => {
      const longSnippet = "a".repeat(500);
      const result = await runActiveMemory(
        buildArgs({
          index: stubIndex([hitOf("MEMORY.md:1-5", longSnippet)]),
          options: { enabled: true, maxSummaryChars: 50 },
        }),
      );
      expect(result.summary?.length).toBe(50);
      expect(result.summary?.endsWith("…")).toBe(true);
    });

    it("test_status_no_recall_when_index_returns_empty", async () => {
      const result = await runActiveMemory(buildArgs({ index: stubIndex([]) }));
      expect(result.status).toBe("no-recall");
      expect(result.hits).toEqual([]);
      expect(result.summary).toBeUndefined();
    });
  });

  describe("queryMode buildQuery semantics", () => {
    it("test_message_mode_uses_only_userText", async () => {
      let captured = "";
      const idx: MemoryIndex = {
        sync: async () => ({
          filesScanned: 0,
          filesUpdated: 0,
          chunksWritten: 0,
          chunksEmbedded: 0,
        }),
        search: async (q) => {
          captured = q;
          return [];
        },
        status: () =>
          ({
            backend: "fts-only",
            filesIndexed: 0,
            chunksIndexed: 0,
          }) as never,
        close: () => undefined,
      };
      await runActiveMemory(
        buildArgs({
          userText: "current",
          priorMessages: [
            { role: "user", text: "prior1" },
            { role: "user", text: "prior2" },
          ],
          index: idx,
          options: { enabled: true, queryMode: "message" },
        }),
      );
      expect(captured).toBe("current");
    });

    it("test_recent_mode_concatenates_last_N_user_turns_plus_userText", async () => {
      let captured = "";
      const idx: MemoryIndex = {
        sync: async () => ({
          filesScanned: 0,
          filesUpdated: 0,
          chunksWritten: 0,
          chunksEmbedded: 0,
        }),
        search: async (q) => {
          captured = q;
          return [];
        },
        status: () =>
          ({
            backend: "fts-only",
            filesIndexed: 0,
            chunksIndexed: 0,
          }) as never,
        close: () => undefined,
      };
      await runActiveMemory(
        buildArgs({
          userText: "current",
          priorMessages: [
            { role: "user", text: "p1" },
            { role: "user", text: "p2" },
            { role: "user", text: "p3" },
            { role: "user", text: "p4" },
          ],
          index: idx,
          options: { enabled: true, queryMode: "recent", recentUserTurns: 2 },
        }),
      );
      expect(captured).toBe("p3\np4\ncurrent");
    });

    it("test_full_mode_concatenates_all_user_turns_plus_userText", async () => {
      let captured = "";
      const idx: MemoryIndex = {
        sync: async () => ({
          filesScanned: 0,
          filesUpdated: 0,
          chunksWritten: 0,
          chunksEmbedded: 0,
        }),
        search: async (q) => {
          captured = q;
          return [];
        },
        status: () =>
          ({
            backend: "fts-only",
            filesIndexed: 0,
            chunksIndexed: 0,
          }) as never,
        close: () => undefined,
      };
      await runActiveMemory(
        buildArgs({
          userText: "current",
          priorMessages: [
            { role: "user", text: "p1" },
            { role: "assistant", text: "ignored" },
            { role: "user", text: "p2" },
          ],
          index: idx,
          options: { enabled: true, queryMode: "full" },
        }),
      );
      expect(captured).toBe("p1\np2\ncurrent");
    });
  });

  describe("cache integration", () => {
    it("test_cache_hit_short_circuits_returning_cached_result", async () => {
      let lookups = 0;
      const cache: ActiveMemoryCache = {
        get: () => {
          lookups++;
          return {
            summary: "from cache",
            durationMs: 0,
            status: "ok",
            hits: [],
          };
        },
        set: () => {},
        size: () => 0,
      } as ActiveMemoryCache;

      let searched = false;
      const idx: MemoryIndex = {
        sync: async () => ({
          filesScanned: 0,
          filesUpdated: 0,
          chunksWritten: 0,
          chunksEmbedded: 0,
        }),
        search: async () => {
          searched = true;
          return [];
        },
        status: () =>
          ({
            backend: "fts-only",
            filesIndexed: 0,
            chunksIndexed: 0,
          }) as never,
        close: () => undefined,
      };

      const result = await runActiveMemory(buildArgs({ cache, index: idx }));
      expect(result.summary).toBe("from cache");
      expect(lookups).toBe(1);
      expect(searched).toBe(false);
    });
  });

  describe("ActiveMemoryOptions DEFAULTS pinned by behavior", () => {
    it("test_default_queryMode_recent_pins_constructed_query", async () => {
      let captured = "";
      const idx: MemoryIndex = {
        sync: async () => ({
          filesScanned: 0,
          filesUpdated: 0,
          chunksWritten: 0,
          chunksEmbedded: 0,
        }),
        search: async (q) => {
          captured = q;
          return [];
        },
        status: () =>
          ({
            backend: "fts-only",
            filesIndexed: 0,
            chunksIndexed: 0,
          }) as never,
        close: () => undefined,
      };
      const opts: ActiveMemoryOptions = { enabled: true };
      await runActiveMemory(
        buildArgs({
          userText: "current",
          priorMessages: [
            { role: "user", text: "p1" },
            { role: "user", text: "p2" },
            { role: "user", text: "p3" },
          ],
          index: idx,
          options: opts,
        }),
      );
      // Default recentUserTurns=2 → last 2 user turns + userText.
      expect(captured).toBe("p2\np3\ncurrent");
    });
  });
});
