/**
 * IndexManager.open dispatcher tests — runs WITHOUT @lancedb/lancedb peer
 * (default suite). Covers:
 *
 *   - backend defaults to "sqlite-vec" (consumer omits)
 *   - explicit "sqlite-vec" goes to SQLite path
 *   - EC-1: invalid backend string throws ConfigurationError("invalid_memory_backend")
 *   - lance + no embedding throws ConfigurationError("lance_requires_embedding")
 *   - lance + embedding + no peer throws ConfigurationError("lance_backend_unavailable")
 *
 * Lance HAPPY-PATH dispatch (peer present → returns LanceMemoryAdapter)
 * lives in `tests/integration/lance-end-to-end.test.ts` env-gated.
 *
 * @internal
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfigurationError } from "../../../src/errors.js";
import { IndexManager } from "../../../src/internal/memory/index-manager.js";
import { isLanceAvailable } from "../../../src/internal/memory/lance-index.js";

describe("IndexManager.open — dispatcher (lancedb-backend-ship-v1-1 P2)", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "im-dispatch-"));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("default backend (undefined) returns IndexManager (SQLite path)", async () => {
    const idx = await IndexManager.open({ cwd: tmpRoot });
    expect(idx).toBeInstanceOf(IndexManager);
    idx.close();
  });

  it("explicit 'sqlite-vec' returns IndexManager", async () => {
    const idx = await IndexManager.open({ cwd: tmpRoot, backend: "sqlite-vec" });
    expect(idx).toBeInstanceOf(IndexManager);
    idx.close();
  });

  it("EC-1: invalid backend string throws ConfigurationError(invalid_memory_backend)", async () => {
    await expect(
      IndexManager.open({
        cwd: tmpRoot,
        // biome-ignore lint/suspicious/noExplicitAny: deliberate runtime escape — TS union is compile-time only
        backend: "lancedb" as any,
      }),
    ).rejects.toMatchObject({
      code: "invalid_memory_backend",
    });
  });

  it("EC-1: empty-string backend throws ConfigurationError(invalid_memory_backend)", async () => {
    await expect(
      IndexManager.open({
        cwd: tmpRoot,
        // biome-ignore lint/suspicious/noExplicitAny: deliberate runtime escape
        backend: "" as any,
      }),
    ).rejects.toMatchObject({
      code: "invalid_memory_backend",
    });
  });

  it("backend 'lance' WITHOUT embedding throws ConfigurationError(lance_requires_embedding)", async () => {
    await expect(IndexManager.open({ cwd: tmpRoot, backend: "lance" })).rejects.toMatchObject({
      code: "lance_requires_embedding",
    });
  });

  it.skipIf(isLanceAvailable())(
    "backend 'lance' WITHOUT @lancedb/lancedb peer throws lance_backend_unavailable",
    async () => {
      // Minimal embedding stub — exists only to pass the embedding-required
      // check; never actually invoked because LanceIndex.open fails first
      // at the requireLance() step.
      const stubEmbedder = {
        id: "stub",
        model: "stub",
        dimension: 16,
        async embed(): Promise<number[][]> {
          return [];
        },
        stats() {
          return { cacheHits: 0, cacheMisses: 0, httpCalls: 0, retries: 0 };
        },
      };
      await expect(
        IndexManager.open({
          cwd: tmpRoot,
          backend: "lance",
          embedding: stubEmbedder,
        }),
      ).rejects.toBeInstanceOf(ConfigurationError);
    },
  );
});
