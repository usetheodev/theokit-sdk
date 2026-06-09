/**
 * SDK 2.0 Phase 4 Stage 4 #5 — Legacy fallback branch coverage (iter 80).
 *
 * Iter 76-79 proved the peer-present routing works. This file proves
 * the peer-absent FALLBACK works inside sdk-core's Memory class methods
 * + migrate wrapper.
 *
 * Coverage strategy: use `forceSdkMemoryPeerAbsentForTests()` (added
 * iter 80) to make the loader return `null` even though the workspace
 * has sdk-memory installed. This routes through the legacy
 * `internal/memory/*` paths — the same code that v1.x consumers run
 * when they don't install the peer.
 *
 * Both paths MUST produce identical observable behavior. Iter 79's
 * parity test confirmed it via direct sdk-memory probes; iter 80
 * confirms it via the in-process fallback branch.
 */

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  forceSdkMemoryPeerAbsentForTests,
  resetSdkMemoryPeerCacheForTests,
  tryLoadSdkMemoryPeer,
} from "../src/internal/memory/sdk-memory-peer-loader.js";
import { Memory } from "../src/memory.js";
import { migrateSqliteToLance } from "../src/migrate.js";

describe("sdk-core legacy fallback branch (iter 80, Phase 4 #5)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "fallback-"));
    forceSdkMemoryPeerAbsentForTests();
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
    resetSdkMemoryPeerCacheForTests();
  });

  describe("loader respects forced-absent flag", () => {
    it("test_loader_returns_null_when_forced_absent", async () => {
      // Even though workspace has sdk-memory installed, the loader
      // returns null because forceSdkMemoryPeerAbsentForTests was called.
      const mod = await tryLoadSdkMemoryPeer();
      expect(mod).toBeNull();
    });

    it("test_resetForTests_clears_forced_absent_flag", async () => {
      // After reset, peer becomes loadable again.
      resetSdkMemoryPeerCacheForTests();
      const mod = await tryLoadSdkMemoryPeer();
      expect(mod).not.toBeNull();
    });
  });

  describe("Memory.openIndex falls back to legacy internal path", () => {
    it("test_unknown_provider_error_still_thrown_via_legacy_path", async () => {
      // Routes through internal/memory/adapters/catalog.ts now.
      // Error message shape pinned by iter 79's parity test.
      await expect(
        Memory.openIndex({
          cwd,
          // biome-ignore lint/suspicious/noExplicitAny: deliberate runtime escape
          embedding: { provider: "qdrant" as any },
        }),
      ).rejects.toMatchObject({
        message: expect.stringContaining('Unknown embedding provider "qdrant"'),
      });
    });
  });

  describe("Memory.runDreamingSweep falls back to legacy internal path", () => {
    it("test_unknown_provider_error_still_thrown_via_legacy_path", async () => {
      await expect(
        Memory.runDreamingSweep({
          cwd,
          // biome-ignore lint/suspicious/noExplicitAny: deliberate runtime escape
          embedding: { provider: "qdrant" as any },
        }),
      ).rejects.toMatchObject({
        message: expect.stringContaining('Unknown embedding provider "qdrant"'),
      });
    });
  });

  describe("migrateSqliteToLance falls back to legacy internal path", () => {
    it("test_no_legacy_json_no_op_via_legacy_path", async () => {
      const result = await migrateSqliteToLance({
        cwd,
        logger: () => undefined,
      });
      expect(result.countSqlite).toBe(0);
      expect(result.countLance).toBe(0);
      expect(result.validated).toBe(true);
      expect(result.committed).toBe(false);
      expect(result.lancePath).toBe(join(cwd, ".theokit", "memory", "lance"));
    });

    it("test_destination_exists_throws_via_legacy_path", async () => {
      const finalPath = join(cwd, ".theokit", "memory", "lance");
      await mkdir(finalPath, { recursive: true });

      await expect(migrateSqliteToLance({ cwd, logger: () => undefined })).rejects.toMatchObject({
        message: expect.stringContaining("Destination already exists"),
      });
    });
  });
});
