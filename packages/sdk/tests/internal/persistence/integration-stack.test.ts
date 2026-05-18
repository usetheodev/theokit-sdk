/**
 * T6.3 — Integration test exercising the full persistence stack.
 *
 * Asserts the 6 patterns wire together correctly:
 *   1. THEOKIT_HOME override (from vitest.setup.ts)
 *   2. atomicWriteJson (auto-mkdir, atomic rename)
 *   3. withFileLock (cross-process via proper-lockfile + companion lock file)
 *   4. migrateSchema (SQLite forward-only)
 *   5. applyWalWithFallback (WAL primary, DELETE fallback)
 *   6. sanitizeFts5Query (auto-quote hyphenated identifiers)
 *
 * @internal
 */

import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  applyWalWithFallback,
  atomicWriteJson,
  getTheokitHome,
  migrateSchema,
  readVersionedJson,
  sanitizeFts5Query,
  withFileLock,
  writeVersionedJson,
} from "../../../src/internal/persistence/index.js";

describe("persistence stack integration", () => {
  it("end-to-end: env → atomic-write → file-lock → migrate → WAL → FTS5", async () => {
    // 1. THEOKIT_HOME override (autouse setup in vitest.setup.ts)
    const home = getTheokitHome("/should-be-ignored");
    expect(home).toContain("theokit-test-");

    // 2. atomicWriteJson auto-creates nested dirs
    const registryPath = join(home, "agents", "registry.json");
    await writeVersionedJson(registryPath, { agents: {} }, 1);
    const initial = await readVersionedJson<{ agents: Record<string, unknown> }>({
      path: registryPath,
      currentVersion: 1,
      migrate: () => ({ agents: {} }),
      defaultValue: () => ({ agents: {} }),
    });
    expect(initial).toEqual({ agents: {} });

    // 3. withFileLock serializes concurrent writes
    let counter = 0;
    await Promise.all(
      Array.from({ length: 10 }, () =>
        withFileLock(registryPath, async () => {
          const current = await readVersionedJson<{ counter?: number }>({
            path: registryPath,
            currentVersion: 1,
            migrate: () => ({}),
            defaultValue: () => ({}),
          });
          counter = (current.counter ?? 0) + 1;
          await writeVersionedJson(registryPath, { counter }, 1);
        }),
      ),
    );
    expect(counter).toBe(10);
    const final = await readVersionedJson<{ counter: number }>({
      path: registryPath,
      currentVersion: 1,
      migrate: () => ({ counter: -1 }),
      defaultValue: () => ({ counter: -1 }),
    });
    expect(final.counter).toBe(10);

    // 4. SQLite open with WAL fallback
    const dbPath = join(home, "state.sqlite");
    await atomicWriteJson(join(home, "marker.json"), { dbPath });
    const db = new Database(dbPath);
    try {
      const walResult = applyWalWithFallback(db, "integration-test");
      expect(["wal", "delete"]).toContain(walResult.mode);

      // 5. migrateSchema runs all migrations on fresh DB
      const migrateResult = migrateSchema({
        db,
        currentVersion: 2,
        migrations: [
          { toVersion: 1, up: (d) => d.exec("CREATE TABLE messages (id INTEGER, text TEXT)") },
          {
            toVersion: 2,
            up: (d) => d.exec("CREATE VIRTUAL TABLE messages_fts USING fts5(text)"),
          },
        ],
      });
      expect(migrateResult).toEqual({ from: 0, to: 2, ran: 2 });

      // Seed data with identifier-shaped text.
      db.prepare("INSERT INTO messages (id, text) VALUES (?, ?)").run(1, "error-code in v2.3.1");
      db.prepare("INSERT INTO messages_fts (rowid, text) VALUES (?, ?)").run(
        1,
        "error-code in v2.3.1",
      );

      // 6. sanitizeFts5Query auto-quotes the hyphenated token so FTS5 finds it.
      const safe = sanitizeFts5Query("error-code");
      expect(safe).toBe('"error-code"');
      const rows = db
        .prepare("SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?")
        .all(safe) as Array<{ rowid: number }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.rowid).toBe(1);

      // EC-3: empty-after-sanitize is short-circuited (caller responsibility).
      const empty = sanitizeFts5Query("[[[");
      expect(empty).toBe("");
    } finally {
      db.close();
    }
  });
});
