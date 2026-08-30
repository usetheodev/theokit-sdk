/**
 * sdk-memory `tools` unit test (iter 64).
 *
 * Validates the iter 64 hybrid copy of `internal/memory/tools.ts`
 * from sdk-core. sdk-memory now ships the canonical LLM-facing
 * memory_search + memory_get tools per ADR D5.
 *
 * sdk-core retains its copy for v1.x memory-tools back-compat.
 * Both copies byte-equivalent at runtime (same JSON Schema shape,
 * same description text, same EC-2 path-escape rejection, same
 * EC-10 maxTotalChars cap default 16384, same corpus→sources
 * mapping).
 *
 * Uses an in-memory stub MemoryIndex (no SQLite/Lance) so the tests
 * exercise the tool wrapper math without standing up a real index.
 * memory_get tests use temp-dir + real file I/O (no mocks).
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createMemoryGetTool,
  createMemorySearchTool,
  type IndexStatus,
  type MemoryIndex,
  type MemorySearchHit,
  resolveMemoryRoot,
} from "@theokit/sdk-memory";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/** Build a stub MemoryIndex that returns pre-canned hits. */
function stubIndex(
  hits: ReadonlyArray<MemorySearchHit>,
  captureLastSearch?: (query: string, opts: unknown) => void,
): MemoryIndex {
  return {
    sync: async () => ({
      filesScanned: 0,
      filesUpdated: 0,
      chunksWritten: 0,
      chunksEmbedded: 0,
    }),
    search: async (query, opts) => {
      captureLastSearch?.(query, opts);
      return [...hits];
    },
    status: () =>
      ({
        backend: "sqlite-vec",
        files: 0,
        chunks: 0,
        embedded: 0,
      }) as unknown as IndexStatus,
    close: () => undefined,
  };
}

function makeHit(path: string, snippet: string, score = 0.9): MemorySearchHit {
  return {
    path,
    startLine: 1,
    endLine: 5,
    score,
    textScore: score,
    snippet,
    source: "memory",
    citation: `${path}:1-5`,
  };
}

describe("sdk-memory tools (iter 64)", () => {
  describe("createMemorySearchTool — schema + execute", () => {
    it("test_search_tool_metadata_shape", () => {
      const index = stubIndex([]);
      const tool = createMemorySearchTool({ index });
      expect(tool.name).toBe("memory_search");
      expect(tool.description.length).toBeGreaterThan(50);
      expect(tool.inputSchema).toMatchObject({
        type: "object",
        required: ["query"],
        properties: expect.objectContaining({
          query: { type: "string", description: expect.any(String) },
        }),
        additionalProperties: false,
      });
    });

    it("test_search_passes_query_and_default_maxResults_10_to_index", async () => {
      let captured: { query: string; opts: unknown } | undefined;
      const index = stubIndex([makeHit("MEMORY.md", "hit one")], (q, o) => {
        captured = { query: q, opts: o };
      });
      const tool = createMemorySearchTool({ index });

      const result = await tool.execute({ query: "find me" });
      expect(captured?.query).toBe("find me");
      expect((captured?.opts as { maxResults: number }).maxResults).toBe(10);

      const parsed = JSON.parse(result) as { hits: MemorySearchHit[]; truncated: boolean };
      expect(parsed.truncated).toBe(false);
      expect(parsed.hits.length).toBe(1);
      expect(parsed.hits[0]?.snippet).toBe("hit one");
    });

    it("test_search_throws_typed_error_when_query_missing", async () => {
      const tool = createMemorySearchTool({ index: stubIndex([]) });
      await expect(tool.execute({})).rejects.toMatchObject({
        message: expect.stringContaining("query is required"),
      });
    });

    it("test_search_corpus_memory_maps_to_sources_memory", async () => {
      let captured: unknown;
      const index = stubIndex([], (_q, o) => {
        captured = o;
      });
      const tool = createMemorySearchTool({ index });
      await tool.execute({ query: "x", corpus: "memory" });
      expect((captured as { sources: string[] }).sources).toEqual(["memory"]);
    });

    it("test_search_corpus_all_drops_sources_filter", async () => {
      let captured: { sources?: unknown } = {};
      const index = stubIndex([], (_q, o) => {
        captured = o as { sources?: unknown };
      });
      const tool = createMemorySearchTool({ index });
      await tool.execute({ query: "x", corpus: "all" });
      expect(captured.sources).toBeUndefined();
    });

    it("test_search_caps_response_at_maxTotalChars_EC10", async () => {
      // 100 hits × ~250 char snippet each = ~25000 chars; cap at 5000.
      const hits = Array.from({ length: 100 }, (_, i) => makeHit(`f${i}.md`, "x".repeat(250)));
      const tool = createMemorySearchTool({
        index: stubIndex(hits),
        maxTotalChars: 5000,
      });
      const result = await tool.execute({ query: "anything" });
      const parsed = JSON.parse(result) as { hits: MemorySearchHit[]; truncated: boolean };
      expect(parsed.truncated).toBe(true);
      expect(parsed.hits.length).toBeLessThan(100);
      expect(parsed.hits.length).toBeGreaterThan(0);
    });
  });

  describe("createMemoryGetTool — schema + execute + EC-2 path guard", () => {
    let cwd: string;
    beforeEach(async () => {
      cwd = await mkdtemp(join(tmpdir(), "sdk-memory-tools-"));
      await mkdir(resolveMemoryRoot(cwd), { recursive: true });
    });
    afterEach(async () => {
      await rm(cwd, { recursive: true, force: true });
    });

    it("test_get_tool_metadata_shape", () => {
      const tool = createMemoryGetTool({ root: resolveMemoryRoot(cwd) });
      expect(tool.name).toBe("memory_get");
      expect(tool.inputSchema).toMatchObject({
        type: "object",
        required: ["path"],
        properties: expect.objectContaining({
          path: { type: "string", description: expect.any(String) },
        }),
        additionalProperties: false,
      });
    });

    it("test_get_reads_bounded_excerpt_from_memory_root", async () => {
      const content = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join("\n");
      await writeFile(join(resolveMemoryRoot(cwd), "MEMORY.md"), content);

      const tool = createMemoryGetTool({ root: resolveMemoryRoot(cwd) });
      const result = await tool.execute({ path: "MEMORY.md", from: 3, lines: 3 });
      const parsed = JSON.parse(result) as {
        path: string;
        from: number;
        text: string;
        totalLines: number;
      };
      expect(parsed.path).toBe("MEMORY.md");
      expect(parsed.from).toBe(3);
      expect(parsed.text).toBe("line3\nline4\nline5");
      expect(parsed.totalLines).toBe(10);
    });

    it("test_get_rejects_path_traversal_with_typed_ConfigurationError_EC2", async () => {
      const tool = createMemoryGetTool({ root: resolveMemoryRoot(cwd) });
      await expect(tool.execute({ path: "../../../etc/passwd" })).rejects.toMatchObject({
        message: expect.stringContaining("memory_get rejected path that escapes memory root"),
      });
    });

    it("test_get_throws_typed_error_when_path_missing", async () => {
      const tool = createMemoryGetTool({ root: resolveMemoryRoot(cwd) });
      await expect(tool.execute({})).rejects.toMatchObject({
        message: expect.stringContaining("path is required"),
      });
    });
  });
});
