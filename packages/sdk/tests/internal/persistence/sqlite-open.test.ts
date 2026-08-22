import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openSqliteResilient,
  type ResilientSqliteDb,
} from "../../../src/internal/persistence/sqlite-open.js";

/**
 * M0-5 (plan m0-foundation-expose-primitives, T5.1) — `openSqliteResilient`.
 *
 * Generalizes the driver-load + WAL + corruption-recovery plumbing that was
 * duplicated across the two memory `index-db.ts` copies. Gracefully skipped
 * when `better-sqlite3` is unavailable (matches the existing index-db test).
 */
interface TestDb extends ResilientSqliteDb {
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    get(...args: unknown[]): Record<string, unknown> | undefined;
  };
}

async function hasBetterSqlite3(): Promise<boolean> {
  try {
    const mod = await import("better-sqlite3");
    const Ctor = (mod.default ?? mod) as new (path: string) => { close(): void };
    new Ctor(":memory:").close();
    return true;
  } catch {
    return false;
  }
}

const SCHEMA = "CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, v TEXT)";

let available = false;
let dir: string;

beforeAll(async () => {
  available = await hasBetterSqlite3();
  dir = await mkdtemp(join(tmpdir(), "sqlite-open-"));
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe.skipIf(!process.env.VITEST || false)("openSqliteResilient", () => {
  it("test_openSqliteResilient_opens_creates_parents_and_runs_onOpen_after_wal", async (ctx) => {
    // B-126: was `if (...) return;` — a guard that returns from the test body reports PASS
    // having asserted nothing, so a machine without the capability looked identical to one
    // where every assertion held. `ctx.skip()` makes the runner report it SKIPPED instead.
    if (!available) ctx.skip();
    const filePath = join(dir, "nested", "ok.sqlite");
    let onOpenCalls = 0;
    const db = await openSqliteResilient<TestDb>({
      filePath,
      label: "test",
      onOpen: (handle) => {
        onOpenCalls += 1;
        handle.exec(SCHEMA);
      },
    });
    expect(onOpenCalls).toBe(1);
    db.prepare("INSERT INTO t (v) VALUES (?)").run("x");
    const row = db.prepare("SELECT COUNT(*) AS n FROM t").get();
    expect(row?.n).toBe(1);
    db.close();
  });

  it("test_openSqliteResilient_recovers_corrupt_file_renames_aside", async (ctx) => {
    // B-126: was `if (...) return;` — a guard that returns from the test body reports PASS
    // having asserted nothing, so a machine without the capability looked identical to one
    // where every assertion held. `ctx.skip()` makes the runner report it SKIPPED instead.
    if (!available) ctx.skip();
    const filePath = join(dir, "corrupt.sqlite");
    await writeFile(filePath, "GARBAGE NOT A SQLITE DATABASE");
    const db = await openSqliteResilient<TestDb>({
      filePath,
      label: "test",
      recoverCorrupt: true,
      onOpen: (handle) => handle.exec(SCHEMA),
    });
    const row = db.prepare("SELECT COUNT(*) AS n FROM t").get();
    expect(row?.n).toBe(0); // fresh schema after recovery
    db.close();
    const entries = await readdir(dir);
    expect(entries.some((e) => /corrupt\.sqlite\.corrupt-\d+$/.test(e))).toBe(true);
  });

  it("test_openSqliteResilient_recoverCorrupt_false_propagates", async (ctx) => {
    // B-126: was `if (...) return;` — a guard that returns from the test body reports PASS
    // having asserted nothing, so a machine without the capability looked identical to one
    // where every assertion held. `ctx.skip()` makes the runner report it SKIPPED instead.
    if (!available) ctx.skip();
    const filePath = join(dir, "corrupt-no-recover.sqlite");
    await writeFile(filePath, "GARBAGE");
    await expect(
      openSqliteResilient<TestDb>({
        filePath,
        recoverCorrupt: false,
        onOpen: (handle) => handle.exec("SELECT 1 FROM t"),
      }),
    ).rejects.toBeDefined();
  });

  it("test_openSqliteResilient_onOpen_error_propagates", async (ctx) => {
    // B-126: was `if (...) return;` — a guard that returns from the test body reports PASS
    // having asserted nothing, so a machine without the capability looked identical to one
    // where every assertion held. `ctx.skip()` makes the runner report it SKIPPED instead.
    if (!available) ctx.skip();
    const filePath = join(dir, "callback-error.sqlite");
    await expect(
      openSqliteResilient<TestDb>({
        filePath,
        onOpen: () => {
          throw new Error("callback failed");
        },
      }),
    ).rejects.toThrow("callback failed");
  });
});

describe("node:sqlite fallback (flicker-bug fix — the error message PROMISED this fallback)", () => {
  /**
   * Host-gated, and the reason matters: this test replaces ONLY the `better-sqlite3` loader and
   * expects the host's REAL `node:sqlite`. The builtin only became unflagged in later Node 22.x
   * Node 22.x — on **22.12** it still requires `--experimental-sqlite`, and `process.getBuiltinModule`
   * returns empty. It broke exactly like that in the CI matrix (`validate (node 22.12)`), while
   * `validate (node 22)` used to pass.
   *
   * A test cannot prove a fallback to a driver the host does not have. Skipping is honest HERE —
   * but skipping silently would not be, so the reason is written down and the condition is the builtin itself,
   * not a version comparison (which would be wrong again: "22.12" < "22.3" as strings).
   */
  const hasNodeSqlite =
    (process as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule?.(
      "node:sqlite",
    ) !== undefined;
  const itWithBuiltin = hasNodeSqlite ? it : it.skip;

  itWithBuiltin("falls_back_to_node_sqlite_when_better_sqlite3_is_unavailable", async () => {
    const { openSqliteResilient, _setDriverLoadersForTests } = await import(
      "../../../src/internal/persistence/sqlite-open.js"
    );
    const dir = mkdtempSync(join(tmpdir(), "sqlite-fallback-"));
    // Simulate the consumer environment (agent-builder): better-sqlite3 not installed.
    _setDriverLoadersForTests({
      betterSqlite3: async () => {
        throw new Error("Cannot find package");
      },
    });
    try {
      const db = await openSqliteResilient({ filePath: join(dir, "t.sqlite") });
      db.exec("create table t(a)");
      db.exec("insert into t values (1)");
      const row = (db as unknown as { prepare(s: string): { get(): { a?: number } } })
        .prepare("select a from t")
        .get();
      expect(row?.a).toBe(1);
      // the pragma shim the WAL helper depends on:
      const mode = db.pragma("journal_mode", { simple: true });
      expect(typeof mode).toBe("string");
      db.close();
    } finally {
      _setDriverLoadersForTests(undefined);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("clear_error_when_both_drivers_unavailable", async () => {
    const { openSqliteResilient, _setDriverLoadersForTests } = await import(
      "../../../src/internal/persistence/sqlite-open.js"
    );
    const dir = mkdtempSync(join(tmpdir(), "sqlite-none-"));
    _setDriverLoadersForTests({
      betterSqlite3: async () => {
        throw new Error("Cannot find package");
      },
      nodeSqlite: async () => {
        throw new Error("No such built-in module");
      },
    });
    try {
      await expect(openSqliteResilient({ filePath: join(dir, "t.sqlite") })).rejects.toThrow(
        /SQLite driver/,
      );
    } finally {
      _setDriverLoadersForTests(undefined);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
