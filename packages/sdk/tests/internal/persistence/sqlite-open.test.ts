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
  it("test_openSqliteResilient_opens_creates_parents_and_runs_onOpen_after_wal", async () => {
    if (!available) return;
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

  it("test_openSqliteResilient_recovers_corrupt_file_renames_aside", async () => {
    if (!available) return;
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

  it("test_openSqliteResilient_recoverCorrupt_false_propagates", async () => {
    if (!available) return;
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

  it("test_openSqliteResilient_onOpen_error_propagates", async () => {
    if (!available) return;
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
