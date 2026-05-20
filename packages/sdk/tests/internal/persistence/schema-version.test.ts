/**
 * RED tests for T3.1 (migrateSchema) + T3.2 (readVersionedJson / writeVersionedJson).
 * Includes EC-2 (migrate receives full parsed file, not just .data).
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type Migration,
  migrateSchema,
  readVersionedJson,
  writeVersionedJson,
} from "../../../src/internal/persistence/schema-version.js";

describe("migrateSchema", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("runs all migrations on fresh DB", () => {
    const migrations: Migration[] = [
      { toVersion: 1, up: (d) => d.exec("CREATE TABLE a (id INTEGER)") },
      { toVersion: 2, up: (d) => d.exec("CREATE TABLE b (id INTEGER)") },
      { toVersion: 3, up: (d) => d.exec("CREATE TABLE c (id INTEGER)") },
    ];
    const result = migrateSchema({ db, currentVersion: 3, migrations });
    expect(result).toEqual({ from: 0, to: 3, ran: 3 });
    expect(db.pragma("user_version", { simple: true })).toBe(3);
  });

  it("runs only pending migrations after partial upgrade", () => {
    db.pragma("user_version = 2");
    const migrations: Migration[] = [
      { toVersion: 1, up: () => {} },
      { toVersion: 2, up: () => {} },
      { toVersion: 3, up: (d) => d.exec("CREATE TABLE c (id INTEGER)") },
      { toVersion: 4, up: (d) => d.exec("CREATE TABLE d (id INTEGER)") },
    ];
    const result = migrateSchema({ db, currentVersion: 4, migrations });
    expect(result).toEqual({ from: 2, to: 4, ran: 2 });
    expect(db.pragma("user_version", { simple: true })).toBe(4);
  });

  it("skips when already at currentVersion", () => {
    db.pragma("user_version = 3");
    const result = migrateSchema({
      db,
      currentVersion: 3,
      migrations: [
        { toVersion: 1, up: () => {} },
        { toVersion: 2, up: () => {} },
        { toVersion: 3, up: () => {} },
      ],
    });
    expect(result).toEqual({ from: 3, to: 3, ran: 0 });
  });

  it("throws on downgrade attempt", () => {
    db.pragma("user_version = 5");
    expect(() =>
      migrateSchema({
        db,
        currentVersion: 3,
        migrations: [{ toVersion: 1, up: () => {} }],
        label: "test",
      }),
    ).toThrow(/version 5 > current 3/);
  });

  it("rolls back on migration failure (pragma stays at previous)", () => {
    const migrations: Migration[] = [
      { toVersion: 1, up: (d) => d.exec("CREATE TABLE a (id INTEGER)") },
      {
        toVersion: 2,
        up: () => {
          throw new Error("boom");
        },
      },
      { toVersion: 3, up: (d) => d.exec("CREATE TABLE c (id INTEGER)") },
    ];
    expect(() => migrateSchema({ db, currentVersion: 3, migrations })).toThrow("boom");
    // Transaction rolled back entirely: pragma is 0, table `a` never created.
    expect(db.pragma("user_version", { simple: true })).toBe(0);
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{
      name: string;
    }>;
    expect(tables.map((t) => t.name)).not.toContain("a");
  });

  it("result.to reflects last applied version with gaps", () => {
    // Gap in migrations: [1, 3, 4] (missing 2). 1 + 3 + 4 should run.
    const migrations: Migration[] = [
      { toVersion: 1, up: () => {} },
      { toVersion: 3, up: () => {} },
      { toVersion: 4, up: () => {} },
    ];
    const result = migrateSchema({ db, currentVersion: 4, migrations });
    expect(result.ran).toBe(3);
    expect(result.to).toBe(4);
    expect(db.pragma("user_version", { simple: true })).toBe(4);
  });
});

describe("readVersionedJson / writeVersionedJson", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vjson-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns default when file missing", async () => {
    const result = await readVersionedJson<Record<string, unknown>>({
      path: join(dir, "missing.json"),
      currentVersion: 1,
      migrate: () => ({ x: 1 }),
      defaultValue: () => ({ default: true }),
    });
    expect(result).toEqual({ default: true });
  });

  it("returns data when version matches", async () => {
    const path = join(dir, "v1.json");
    await writeVersionedJson(path, { value: 42 }, 1);
    const result = await readVersionedJson<{ value: number }>({
      path,
      currentVersion: 1,
      migrate: () => ({ value: 0 }),
      defaultValue: () => ({ value: -1 }),
    });
    expect(result).toEqual({ value: 42 });
  });

  it("EC-2: migrate receives FULL parsed object (legacy shape)", async () => {
    const path = join(dir, "legacy.json");
    // Legacy shape: `schemaVersion: "1.0"` (not `_schemaVersion`), `agents` at top level.
    await writeFile(
      path,
      JSON.stringify({ schemaVersion: "1.0", agents: { a1: { name: "agent-1" } } }),
      "utf-8",
    );

    let receivedParsed: unknown;
    let receivedVersion = -1;

    const result = await readVersionedJson<Record<string, { name: string }>>({
      path,
      currentVersion: 1,
      migrate: (parsed, fromVersion) => {
        receivedParsed = parsed;
        receivedVersion = fromVersion;
        // Caller knows the legacy shape and digs out .agents.
        const legacy = parsed as {
          schemaVersion?: string;
          agents?: Record<string, { name: string }>;
        };
        return legacy.agents ?? {};
      },
      defaultValue: () => ({}),
    });

    expect(receivedParsed).toEqual({ schemaVersion: "1.0", agents: { a1: { name: "agent-1" } } });
    expect(receivedVersion).toBe(0); // no _schemaVersion field → defaults to 0
    expect(result).toEqual({ a1: { name: "agent-1" } });
  });

  it("returns default when file is corrupt JSON", async () => {
    const path = join(dir, "corrupt.json");
    await writeFile(path, "not-valid-json{", "utf-8");
    const result = await readVersionedJson<Record<string, unknown>>({
      path,
      currentVersion: 1,
      migrate: () => ({ x: 1 }),
      defaultValue: () => ({ default: true }),
    });
    expect(result).toEqual({ default: true });
  });

  it("returns default when stored > current (forward-only)", async () => {
    const path = join(dir, "future.json");
    await writeVersionedJson(path, { x: 1 }, 5);
    const result = await readVersionedJson<Record<string, unknown>>({
      path,
      currentVersion: 2,
      migrate: () => ({ x: -1 }),
      defaultValue: () => ({ default: true }),
    });
    expect(result).toEqual({ default: true });
  });

  it("writeVersionedJson writes _schemaVersion field", async () => {
    const path = join(dir, "out.json");
    await writeVersionedJson(path, { value: 7 }, 3);
    const content = JSON.parse(readFileSync(path, "utf-8"));
    expect(content).toEqual({ _schemaVersion: 3, data: { value: 7 } });
  });
});
