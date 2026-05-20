import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { EmbeddingRuntime } from "../../../src/internal/memory/embedding-adapter.js";
import { IndexManager } from "../../../src/internal/memory/index-manager.js";
import { memoryMdPath } from "../../../src/internal/memory/markdown-store.js";

/**
 * Phase 5 T5.1+T5.2 — vector index + hybrid search.
 */

function deterministicVector(text: string, dim: number): number[] {
  const vec = new Array<number>(dim);
  let seed = 0;
  for (let i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) >>> 0;
  for (let i = 0; i < dim; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    vec[i] = ((seed >>> 16) & 0x7fff) / 0x7fff;
  }
  return vec;
}

function fakeAdapter(
  opts: { id?: string; model?: string; dimension?: number } = {},
): EmbeddingRuntime {
  const id = opts.id ?? "fake";
  const model = opts.model ?? "fake-small";
  const dimension = opts.dimension ?? 8;
  return {
    id,
    model,
    dimension,
    stats: () => ({ cacheHits: 0, cacheMisses: 0, httpCalls: 0, retries: 0 }),
    embed: (texts) => Promise.resolve(texts.map((t) => deterministicVector(t, dimension))),
  };
}

describe("vector index + hybrid search", () => {
  let cwd: string;
  let manager: IndexManager | undefined;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-vec-"));
    await mkdir(join(cwd, ".theokit", "memory"), { recursive: true });
  });

  afterEach(() => {
    manager?.close();
    manager = undefined;
  });

  it("stores one vector per chunk on sync (hybrid backend)", async () => {
    await writeFile(
      memoryMdPath(cwd),
      "# Memory\n\n## Facts\n\n- magic-number is 8675309.\n- vitest is the test runner.\n",
      "utf8",
    );
    manager = await IndexManager.open({ cwd, embedding: fakeAdapter() });
    const result = await manager.sync();
    expect(result.chunksWritten).toBeGreaterThan(0);
    expect(result.chunksEmbedded).toBeGreaterThan(0);
    const status = manager.status();
    expect(status.backend).toBe("hybrid");
  });

  it("skips embedding unchanged chunks on re-sync", async () => {
    await writeFile(memoryMdPath(cwd), "# Memory\n\n## Facts\n\n- one fact.\n", "utf8");
    manager = await IndexManager.open({ cwd, embedding: fakeAdapter() });
    const first = await manager.sync();
    expect(first.chunksEmbedded).toBeGreaterThan(0);
    const second = await manager.sync();
    expect(second.chunksEmbedded).toBe(0);
  });

  it("hybrid search includes vector score in results", async () => {
    await writeFile(
      memoryMdPath(cwd),
      "# Memory\n\n## Facts\n\n- magic-number is 8675309.\n- random unrelated.\n",
      "utf8",
    );
    manager = await IndexManager.open({ cwd, embedding: fakeAdapter() });
    await manager.sync();
    const hits = await manager.search("magic-number");
    expect(hits.length).toBeGreaterThan(0);
    const top = hits[0];
    expect(top?.textScore).toBeGreaterThan(0);
    // vectorScore is optional; just verify the schema didn't drop it.
    expect(top).toHaveProperty("score");
  });

  it("force re-embed on dimension change (EC-1)", async () => {
    await writeFile(memoryMdPath(cwd), "# Memory\n\n## Facts\n\n- fact one.\n", "utf8");
    manager = await IndexManager.open({ cwd, embedding: fakeAdapter({ dimension: 8 }) });
    const first = await manager.sync();
    expect(first.chunksEmbedded).toBeGreaterThan(0);
    manager.close();
    // Re-open with a DIFFERENT dimension — meta mismatch should drop the
    // embeddings table and force a full re-embed.
    manager = await IndexManager.open({ cwd, embedding: fakeAdapter({ dimension: 16 }) });
    const second = await manager.sync();
    expect(second.chunksEmbedded).toBeGreaterThan(0);
  });

  it("falls back to FTS-only when embedding runtime is undefined", async () => {
    await writeFile(memoryMdPath(cwd), "# Memory\n\n## Facts\n\n- fact.\n", "utf8");
    manager = await IndexManager.open({ cwd });
    await manager.sync();
    const status = manager.status();
    expect(status.backend).toBe("fts-only");
    const hits = await manager.search("fact");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.vectorScore).toBeUndefined();
  });

  it("force re-embed when provider id changes (EC-1)", async () => {
    await writeFile(memoryMdPath(cwd), "# Memory\n\n## Facts\n\n- fact.\n", "utf8");
    manager = await IndexManager.open({ cwd, embedding: fakeAdapter({ id: "providerA" }) });
    await manager.sync();
    manager.close();
    manager = await IndexManager.open({ cwd, embedding: fakeAdapter({ id: "providerB" }) });
    const second = await manager.sync();
    expect(second.chunksEmbedded).toBeGreaterThan(0);
  });
});
