/**
 * sdk-memory `index-manager` unit test (iter 72).
 *
 * Validates the iter 72 hybrid copy of `internal/memory/index-manager.ts`
 * from sdk-core. sdk-memory now ships the canonical IndexManager
 * orchestrator that composes every prior Stage 3 move into a single
 * MemoryIndex implementation.
 *
 * sdk-core retains its copy for v1.x back-compat.
 * Both copies byte-equivalent at runtime (same SQLite-default
 * dispatch, same Lance opt-in via assertValidBackend + openLanceIndex,
 * same EC-1 identity drop on dimension/model/provider change, same
 * FTS5 + sqlite-vec hybrid score blend with vectorWeight 0.6 /
 * textWeight 0.4 defaults, same 500-char snippet truncation).
 *
 * Lean test focus: dispatch path verification (assertValidBackend
 * rejection bubbles up, Lance preconditions surface) + SQLite full
 * lifecycle gated on native stack. Full hybrid retrieval matrix is
 * exercised by sdk-core's integration tests.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type EmbeddingRuntime, IndexManager, memoryDir } from "@theokit/sdk-memory";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

async function hasNativeStack(): Promise<boolean> {
  try {
    const mod = await import("better-sqlite3");
    const Ctor = (mod.default ?? mod) as new (path: string) => { close(): void };
    const probe = new Ctor(":memory:");
    probe.close();
    return true;
  } catch {
    return false;
  }
}

describe("sdk-memory index-manager (iter 72)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "sdk-memory-idxmgr-"));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  describe("dispatch path — does not require native stack", () => {
    it("test_invalid_backend_throws_typed_ConfigurationError", async () => {
      // EC-1: TS union is compile-time only; runtime guard MUST catch
      // any consumer-side typo. The error surfaces from
      // assertValidBackend BEFORE openMemoryDb is called, so this
      // test runs reliably even when better-sqlite3 is absent.
      await expect(
        // biome-ignore lint/suspicious/noExplicitAny: deliberate runtime escape
        IndexManager.open({ cwd, backend: "qdrant" as any }),
      ).rejects.toMatchObject({
        message: expect.stringContaining("Invalid memory backend"),
      });
    });

    it("test_lance_backend_without_embedding_throws_lance_requires_embedding", async () => {
      // Lance preconditions enforce embedding presence BEFORE touching
      // the optional @lancedb/lancedb peer. Same EC reachable from
      // either sdk-core or sdk-memory copy.
      await expect(IndexManager.open({ cwd, backend: "lance" })).rejects.toMatchObject({
        message: expect.stringContaining("Lance backend requires an embedding runtime"),
      });
    });
  });

  describe("SQLite full lifecycle (skipped when native stack missing)", () => {
    it("test_open_sync_search_status_close_FTS_only_no_embedding", async (ctx) => {
      if (!(await hasNativeStack())) {
        ctx.skip("better-sqlite3 native stack unavailable on this runner");
      }
      // Seed a tiny memory corpus.
      await mkdir(memoryDir(cwd), { recursive: true });
      await writeFile(
        join(memoryDir(cwd), "MEMORY.md"),
        "# Memory\n\n## Facts\n\n- The user likes pour-over coffee.\n- The user dislikes meetings before 10am.\n",
      );

      const idx = await IndexManager.open({ cwd });
      const sync = await idx.sync();
      expect(sync.filesScanned).toBeGreaterThanOrEqual(1);
      expect(sync.chunksWritten).toBeGreaterThanOrEqual(1);

      const status = idx.status();
      // No embedding wired → FTS-only backend.
      expect(status.backend).toBe("fts-only");
      expect(status.filesIndexed).toBeGreaterThanOrEqual(1);
      expect(status.chunksIndexed).toBeGreaterThanOrEqual(1);

      const hits = await idx.search("coffee");
      expect(hits.length).toBeGreaterThanOrEqual(1);
      const top = hits[0];
      expect(top?.path).toContain("MEMORY.md");
      expect(top?.snippet).toContain("coffee");
      // textScore populated, vectorScore absent (no embedding).
      expect(top?.textScore).toBeGreaterThan(0);
      expect(top?.score).toBeGreaterThan(0);
      expect(top?.vectorScore).toBeUndefined();

      idx.close();
    });

    it("test_empty_query_short_circuits_to_empty_array", async (ctx) => {
      if (!(await hasNativeStack())) {
        ctx.skip("better-sqlite3 native stack unavailable on this runner");
      }
      const idx = await IndexManager.open({ cwd });
      expect(await idx.search("")).toEqual([]);
      expect(await idx.search("   \n\t ")).toEqual([]);
      idx.close();
    });

    it("test_sync_idempotent_unchanged_files_skip", async (ctx) => {
      if (!(await hasNativeStack())) {
        ctx.skip("better-sqlite3 native stack unavailable on this runner");
      }
      await mkdir(memoryDir(cwd), { recursive: true });
      await writeFile(join(memoryDir(cwd), "MEMORY.md"), "# Memory\n\n## Facts\n\n- pin\n");
      const idx = await IndexManager.open({ cwd });

      const first = await idx.sync();
      expect(first.filesUpdated).toBeGreaterThanOrEqual(1);

      // Second sync of unchanged corpus must produce zero updates.
      const second = await idx.sync();
      expect(second.filesUpdated).toBe(0);
      expect(second.chunksWritten).toBe(0);

      idx.close();
    });

    it("test_EC1_identity_change_drops_vector_index_on_re_open", async (ctx) => {
      if (!(await hasNativeStack())) {
        ctx.skip("better-sqlite3 native stack unavailable on this runner");
      }
      // First open with a 3-dim embedding.
      const embedding3: EmbeddingRuntime = {
        id: "stub",
        providerId: "stub",
        model: "v1",
        dimension: 3,
        embed: async (texts: string[]) => texts.map(() => [1, 0, 0]),
      } as unknown as EmbeddingRuntime;
      // Need sqlite-vec for full vector init — report SKIPPED if absent, so an
      // environment without it cannot report PASS for an unexercised path.
      try {
        await import("sqlite-vec");
      } catch {
        ctx.skip("sqlite-vec not installed on this runner");
      }
      const idx1 = await IndexManager.open({ cwd, embedding: embedding3 });
      idx1.close();

      // Re-open with a DIFFERENT dimension → drop + re-create.
      const embedding5: EmbeddingRuntime = {
        id: "stub",
        providerId: "stub",
        model: "v2",
        dimension: 5,
        embed: async (texts: string[]) => texts.map(() => [1, 0, 0, 0, 0]),
      } as unknown as EmbeddingRuntime;
      const idx2 = await IndexManager.open({ cwd, embedding: embedding5 });
      // Open succeeded → EC-1 drop+recreate cycle didn't throw.
      const status = idx2.status();
      expect(status.backend).toBe("hybrid");
      idx2.close();
    });
  });
});
