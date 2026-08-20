/**
 * sdk-memory `index-db` unit test (iter 65).
 *
 * Validates the iter 65 hybrid copy of `internal/memory/index-db.ts`
 * from sdk-core. sdk-memory now ships the canonical SQLite-driver
 * thin wrapper + schema bootstrap + EC-7 corrupt-DB recovery.
 *
 * sdk-core retains its copy for v1.x sqlite-vec back-compat.
 * Both copies byte-equivalent at runtime (same WAL-first init
 * order, same SCHEMA + PRAGMA application, same EC-7 corrupt
 * detection via lowercased message + same `<path>.corrupt-<ts>`
 * rename-aside pattern, same defaultIndexPath layout).
 *
 * Uses temp-dir + real better-sqlite3 driver (no mocks). Tests
 * skip gracefully when better-sqlite3 is not installed (CI-friendly
 * for environments where the native binding fails to compile).
 */

import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defaultIndexPath, type MemoryDb, openMemoryDb } from "@theokit/sdk-memory";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

async function hasBetterSqlite3(): Promise<boolean> {
  try {
    const mod = await import("better-sqlite3");
    const Ctor = (mod.default ?? mod) as new (path: string) => { close(): void };
    // Actually instantiate against in-memory `:memory:` so a native-ABI
    // mismatch (NODE_MODULE_VERSION) skips the test gracefully on CI
    // environments running an unexpected Node version.
    const probe = new Ctor(":memory:");
    probe.close();
    return true;
  } catch {
    return false;
  }
}

describe("sdk-memory index-db (iter 65)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "sdk-memory-indexdb-"));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  describe("defaultIndexPath", () => {
    it("test_resolves_to_theokit_memory_dotindex_memory_sqlite", () => {
      expect(defaultIndexPath(cwd)).toBe(
        join(cwd, ".theokit", "memory", ".index", "memory.sqlite"),
      );
    });
  });

  describe("openMemoryDb (requires better-sqlite3 — gracefully skipped otherwise)", () => {
    it("test_creates_parent_dirs_and_opens_a_writable_db", async (ctx) => {
      // B-126: was `if (...) return;` — a guard that returns from the test body reports PASS
      // having asserted nothing, so a machine without the capability looked identical to one
      // where every assertion held. `ctx.skip()` makes the runner report it SKIPPED instead.
      if (!(await hasBetterSqlite3())) ctx.skip();
      const filePath = defaultIndexPath(cwd);
      const db: MemoryDb = await openMemoryDb({ filePath });

      // exec + prepare must work — proves SCHEMA_STATEMENTS already ran.
      db.exec(
        "INSERT INTO files (path, rel_path, mtime, hash) VALUES (?, ?, ?, ?)".replace(
          /\?/g,
          () => "''",
        ),
      );
      const stmt = db.prepare("SELECT COUNT(*) AS count FROM files");
      const row = stmt.get() as { count: number };
      expect(row.count).toBeGreaterThanOrEqual(1);
      db.close();

      // File landed on disk at the expected path.
      await expect(access(filePath)).resolves.toBeUndefined();
    });

    it("test_chunks_fts_virtual_table_present_after_open", async (ctx) => {
      // B-126: was `if (...) return;` — a guard that returns from the test body reports PASS
      // having asserted nothing, so a machine without the capability looked identical to one
      // where every assertion held. `ctx.skip()` makes the runner report it SKIPPED instead.
      if (!(await hasBetterSqlite3())) ctx.skip();
      const db = await openMemoryDb({ filePath: defaultIndexPath(cwd) });
      // chunks_fts virtual table should exist (FTS5 search foundation).
      const row = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = 'chunks_fts'",
        )
        .get() as { name: string } | undefined;
      expect(row?.name).toBe("chunks_fts");
      db.close();
    });

    it("test_EC7_corrupt_db_renamed_aside_and_rebuilt", async (ctx) => {
      // B-126: was `if (...) return;` — a guard that returns from the test body reports PASS
      // having asserted nothing, so a machine without the capability looked identical to one
      // where every assertion held. `ctx.skip()` makes the runner report it SKIPPED instead.
      if (!(await hasBetterSqlite3())) ctx.skip();
      const filePath = defaultIndexPath(cwd);

      // Pre-seed the path with garbage bytes — SQLite will refuse to open.
      const { mkdir } = await import("node:fs/promises");
      await mkdir(join(cwd, ".theokit", "memory", ".index"), { recursive: true });
      await writeFile(filePath, "NOT A VALID SQLITE FILE — should trigger EC-7");

      // openMemoryDb must rename the bad file aside and create a fresh one.
      const db = await openMemoryDb({ filePath });
      const row = db.prepare("SELECT COUNT(*) AS count FROM files").get() as { count: number };
      expect(row.count).toBe(0); // fresh table → empty
      db.close();

      // Bad file should have been renamed to something with the `.corrupt-` suffix.
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(join(cwd, ".theokit", "memory", ".index"));
      const corrupt = entries.find((e) => e.includes(".corrupt-"));
      expect(corrupt).toBeDefined();
    });

    it("test_recoverCorrupt_false_propagates_the_open_error", async (ctx) => {
      // B-126: was `if (...) return;` — a guard that returns from the test body reports PASS
      // having asserted nothing, so a machine without the capability looked identical to one
      // where every assertion held. `ctx.skip()` makes the runner report it SKIPPED instead.
      if (!(await hasBetterSqlite3())) ctx.skip();
      const filePath = defaultIndexPath(cwd);

      const { mkdir } = await import("node:fs/promises");
      await mkdir(join(cwd, ".theokit", "memory", ".index"), { recursive: true });
      await writeFile(filePath, "ANOTHER GARBAGE STREAM");

      await expect(openMemoryDb({ filePath, recoverCorrupt: false })).rejects.toThrow();
    });
  });
});
