/**
 * sdk-memory `vec-index` unit test (iter 67).
 *
 * Validates the iter 67 hybrid copy of `internal/memory/vec-index.ts`
 * from sdk-core. sdk-memory now ships the canonical sqlite-vec
 * helpers (identity meta + virtual-table create/drop + KNN search
 * + missing-chunk embed sweep).
 *
 * sdk-core retains its copy for v1.x sqlite-vec back-compat.
 * Both copies byte-equivalent at runtime (same META keys, same
 * INSERT...ON CONFLICT DO UPDATE upsert shape for identity, same
 * DELETE+INSERT semantics for vec0 upsert with BigInt id binding,
 * same KNN MATCH/k SQL, same LEFT JOIN missing-chunk query).
 *
 * Pure logic tests (packVector + identityMatches) always run.
 * SQLite-driven tests gracefully skip when the native stack is
 * unavailable (Node-ABI mismatch / sqlite-vec not installed).
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createVectorIndex,
  dropVectorIndex,
  type EmbeddingIdentity,
  type EmbeddingRuntime,
  embedMissingChunks,
  identityMatches,
  loadSqliteVecExtension,
  META_KEY_DIMENSION,
  META_KEY_MODEL,
  META_KEY_PROVIDER_ID,
  openMemoryDb,
  packVector,
  readEmbeddingIdentity,
  upsertEmbedding,
  vectorSearch,
  writeEmbeddingIdentity,
} from "@theokit/sdk-memory";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

async function hasNativeStack(): Promise<boolean> {
  try {
    const mod = await import("better-sqlite3");
    const Ctor = (mod.default ?? mod) as new (path: string) => { close(): void };
    const probe = new Ctor(":memory:");
    probe.close();
    await import("sqlite-vec");
    return true;
  } catch {
    return false;
  }
}

describe("sdk-memory vec-index (iter 67)", () => {
  describe("pure logic — always runs", () => {
    it("test_META_keys_pinned", () => {
      expect(META_KEY_PROVIDER_ID).toBe("embedding.providerId");
      expect(META_KEY_MODEL).toBe("embedding.model");
      expect(META_KEY_DIMENSION).toBe("embedding.dimension");
    });

    it("test_identityMatches_compares_all_three_fields", () => {
      const a: EmbeddingIdentity = { providerId: "openai", model: "text-embed-3", dimension: 1536 };
      const b: EmbeddingIdentity = { providerId: "openai", model: "text-embed-3", dimension: 1536 };
      const cDifferentProvider: EmbeddingIdentity = { ...a, providerId: "voyage" };
      const cDifferentModel: EmbeddingIdentity = { ...a, model: "text-embed-2" };
      const cDifferentDim: EmbeddingIdentity = { ...a, dimension: 768 };
      expect(identityMatches(a, b)).toBe(true);
      expect(identityMatches(a, cDifferentProvider)).toBe(false);
      expect(identityMatches(a, cDifferentModel)).toBe(false);
      expect(identityMatches(a, cDifferentDim)).toBe(false);
    });

    it("test_packVector_emits_Float32Array_byte_layout", () => {
      const buf = packVector([1, 2, 3]);
      expect(Buffer.isBuffer(buf)).toBe(true);
      // 3 floats × 4 bytes = 12-byte buffer.
      expect(buf.byteLength).toBe(12);
      // Round-trip the Float32Array view.
      const view = new Float32Array(buf.buffer, buf.byteOffset, 3);
      expect(view[0]).toBeCloseTo(1, 5);
      expect(view[1]).toBeCloseTo(2, 5);
      expect(view[2]).toBeCloseTo(3, 5);
    });

    it("test_packVector_handles_holes_as_zero", () => {
      // ReadonlyArray<number> with `undefined` (via sparse pattern) coerces to 0.
      const sparse: number[] = [];
      sparse[2] = 5;
      const buf = packVector(sparse);
      const view = new Float32Array(buf.buffer, buf.byteOffset, 3);
      expect(view[0]).toBe(0);
      expect(view[1]).toBe(0);
      expect(view[2]).toBeCloseTo(5, 5);
    });
  });

  describe("SQLite + sqlite-vec roundtrip (skipped when native stack missing)", () => {
    let cwd: string;

    beforeEach(async () => {
      cwd = await mkdtemp(join(tmpdir(), "sdk-memory-vec-"));
    });
    afterEach(async () => {
      await rm(cwd, { recursive: true, force: true });
    });

    it("test_identity_roundtrip_meta_table", async (ctx) => {
      // B-126: was `if (...) return;` — a guard that returns from the test body reports PASS
      // having asserted nothing, so a machine without the capability looked identical to one
      // where every assertion held. `ctx.skip()` makes the runner report it SKIPPED instead.
      if (!(await hasNativeStack())) ctx.skip();
      const db = await openMemoryDb({ filePath: join(cwd, "id.sqlite") });

      expect(readEmbeddingIdentity(db)).toBeUndefined();
      writeEmbeddingIdentity(db, {
        providerId: "openai",
        model: "text-embed-3-small",
        dimension: 1536,
      });
      const round = readEmbeddingIdentity(db);
      expect(round).toEqual({
        providerId: "openai",
        model: "text-embed-3-small",
        dimension: 1536,
      });

      // Overwrite (ON CONFLICT DO UPDATE).
      writeEmbeddingIdentity(db, {
        providerId: "voyage",
        model: "voyage-3",
        dimension: 1024,
      });
      expect(readEmbeddingIdentity(db)?.providerId).toBe("voyage");
      db.close();
    });

    it("test_create_drop_upsert_search_vec_roundtrip", async (ctx) => {
      // B-126: was `if (...) return;` — a guard that returns from the test body reports PASS
      // having asserted nothing, so a machine without the capability looked identical to one
      // where every assertion held. `ctx.skip()` makes the runner report it SKIPPED instead.
      if (!(await hasNativeStack())) ctx.skip();
      const db = await openMemoryDb({ filePath: join(cwd, "vec.sqlite") });
      await loadSqliteVecExtension(db);

      const DIM = 3;
      createVectorIndex(db, DIM);

      // Need at least one chunk row before referencing chunk_id; insert
      // 3 chunk rows with file_id pointing at a single seeded file.
      db.exec("INSERT INTO files (path, rel_path, mtime, hash) VALUES ('test', 'test', 0, 'hash')");
      for (let i = 0; i < 3; i++) {
        db.exec(
          `INSERT INTO chunks (file_id, start_line, end_line, text, hash) VALUES (1, ${i + 1}, ${i + 1}, 'chunk${i}', 'h${i}')`,
        );
      }

      // Upsert distinct unit vectors so KNN ordering is unambiguous.
      upsertEmbedding(db, 1, [1, 0, 0]);
      upsertEmbedding(db, 2, [0, 1, 0]);
      upsertEmbedding(db, 3, [0, 0, 1]);

      // Search for a vector close to chunk 2 — top-1 hit should be id 2.
      const top1 = vectorSearch(db, [0, 1, 0], 1);
      expect(top1.length).toBe(1);
      expect(top1[0]?.chunk_id).toBe(2);
      expect(top1[0]?.distance).toBeGreaterThanOrEqual(0);

      // K=3 returns all hits sorted by distance.
      const top3 = vectorSearch(db, [0, 1, 0], 3);
      expect(top3.length).toBe(3);
      expect(top3[0]?.chunk_id).toBe(2);

      // Idempotent upsert — replacing chunk 1's vector with a different
      // value keeps row count at 3.
      upsertEmbedding(db, 1, [0.7, 0.7, 0]);
      const verify = vectorSearch(db, [1, 0, 0], 3);
      expect(verify.length).toBe(3);

      // Drop tears down virtual table cleanly.
      dropVectorIndex(db);
      const remaining = db.prepare("SELECT name FROM sqlite_master WHERE name='embeddings'").get();
      expect(remaining).toBeUndefined();
      db.close();
    });

    it("test_embedMissingChunks_only_embeds_chunks_without_vectors", async (ctx) => {
      // B-126: was `if (...) return;` — a guard that returns from the test body reports PASS
      // having asserted nothing, so a machine without the capability looked identical to one
      // where every assertion held. `ctx.skip()` makes the runner report it SKIPPED instead.
      if (!(await hasNativeStack())) ctx.skip();
      const db = await openMemoryDb({ filePath: join(cwd, "missing.sqlite") });
      await loadSqliteVecExtension(db);
      createVectorIndex(db, 3);

      db.exec("INSERT INTO files (path, rel_path, mtime, hash) VALUES ('test', 'test', 0, 'hash')");
      for (let i = 0; i < 4; i++) {
        db.exec(
          `INSERT INTO chunks (file_id, start_line, end_line, text, hash) VALUES (1, ${i + 1}, ${i + 1}, 'text-${i}', 'h${i}')`,
        );
      }
      // Pre-embed chunks 1 and 3; leave 2 and 4 missing.
      upsertEmbedding(db, 1, [1, 0, 0]);
      upsertEmbedding(db, 3, [0, 0, 1]);

      let embedCalls = 0;
      const runtime: EmbeddingRuntime = {
        embed: async (texts: string[]) => {
          embedCalls++;
          return texts.map(() => [0.5, 0.5, 0.5]);
        },
        dimension: 3,
        providerId: "stub",
        model: "stub",
      } as unknown as EmbeddingRuntime;

      const embedded = await embedMissingChunks({ db, runtime });
      expect(embedded).toBe(2);
      expect(embedCalls).toBe(1); // one batch call

      // Second sweep: nothing should be left to embed.
      const embeddedAgain = await embedMissingChunks({ db, runtime });
      expect(embeddedAgain).toBe(0);
      db.close();
    });
  });
});
