/**
 * SDK 2.0 Phase 4 (Stage 4) — Memory class peer routing test (iter 77).
 *
 * Validates that `Memory.openIndex` and `Memory.runDreamingSweep`
 * route through `@theokit/sdk-memory` when the peer is installed
 * (workspace setup — sdk-memory IS resolvable here).
 *
 * The "peer absent" branch (legacy internal fallback) is preserved
 * structurally by the unchanged second half of each method body —
 * we can't exercise both branches in the same process because the
 * loader memoizes its resolution. Iter 76's peer-loader test pinned
 * the loader's null-branch return shape directly.
 *
 * Tests skip SQLite-dependent paths gracefully when better-sqlite3's
 * native binding mismatches the runtime Node version (CI env).
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Memory } from "@theokit/sdk";
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

describe("sdk-core Memory class peer routing (iter 77, Phase 4 #2)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "sdk-memory-routing-"));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  describe("openIndex peer routing", () => {
    it("test_rejects_unknown_embedding_provider_through_peer_path", async () => {
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

    it("test_opens_sqlite_default_when_native_stack_available", async (ctx) => {
      // B-126: was `if (...) return;` — a guard that returns from the test body reports PASS
      // having asserted nothing, so a machine without the capability looked identical to one
      // where every assertion held. `ctx.skip()` makes the runner report it SKIPPED instead.
      if (!(await hasNativeStack())) ctx.skip();
      const idx = await Memory.openIndex({ cwd });
      const status = idx.status();
      expect(status.backend).toBe("fts-only");
      expect(typeof status.filesIndexed).toBe("number");
      await idx.close();
    });

    it("test_sync_search_status_lifecycle_routes_through_peer_FTS_only", async (ctx) => {
      // B-126: was `if (...) return;` — a guard that returns from the test body reports PASS
      // having asserted nothing, so a machine without the capability looked identical to one
      // where every assertion held. `ctx.skip()` makes the runner report it SKIPPED instead.
      if (!(await hasNativeStack())) ctx.skip();
      const idx = await Memory.openIndex({ cwd });
      // Empty corpus (no seeded MEMORY.md) — sync returns zero counts.
      const sync = await idx.sync();
      expect(sync.filesScanned).toBe(0);
      expect(sync.chunksWritten).toBe(0);
      const hits = await idx.search("anything");
      expect(hits).toEqual([]);
      await idx.close();
    });
  });

  describe("runDreamingSweep peer routing", () => {
    it("test_rejects_unknown_embedding_provider_through_peer_path", async () => {
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

    // Real-provider runs would need network credentials; the unknown-
    // provider rejection above proves the peer routing is wired —
    // adapter resolution table is sourced from the peer module.
  });
});
