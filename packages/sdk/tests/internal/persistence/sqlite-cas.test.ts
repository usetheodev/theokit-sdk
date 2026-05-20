/**
 * Tests for SQLite CAS update (T2.2, ADR D83).
 */

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { casUpdate } from "../../../src/internal/persistence/sqlite-cas.js";

describe("casUpdate (T2.2)", () => {
  type DB = InstanceType<typeof Database>;
  let db: DB;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE test_registry (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        version INTEGER NOT NULL
      );
    `);
    db.prepare("INSERT INTO test_registry (id, status, version) VALUES (?, ?, ?)").run(
      "agent-1",
      "ready",
      1,
    );
  });

  afterEach(() => {
    db.close();
  });

  it("returns true on version match", () => {
    const won = casUpdate(
      db,
      "UPDATE test_registry SET status = ?, version = version + 1 WHERE id = ? AND version = ?",
      ["running", "agent-1", 1],
    );
    expect(won).toBe(true);
    const row = db
      .prepare("SELECT status, version FROM test_registry WHERE id = ?")
      .get("agent-1") as { status: string; version: number };
    expect(row.status).toBe("running");
    expect(row.version).toBe(2);
  });

  it("returns false on version mismatch", () => {
    const won = casUpdate(
      db,
      "UPDATE test_registry SET status = ?, version = version + 1 WHERE id = ? AND version = ?",
      ["running", "agent-1", 999],
    );
    expect(won).toBe(false);
  });

  it("returns false when row not found", () => {
    const won = casUpdate(
      db,
      "UPDATE test_registry SET status = ?, version = version + 1 WHERE id = ? AND version = ?",
      ["running", "agent-nonexistent", 1],
    );
    expect(won).toBe(false);
  });

  it("concurrent: 5 sequential CAS attempts with stale version — only first wins", () => {
    // SQLite in-process is serialized; this proves CAS correctness, not OS-level race.
    const results: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      const won = casUpdate(
        db,
        "UPDATE test_registry SET status = ?, version = version + 1 WHERE id = ? AND version = ?",
        ["running", "agent-1", 1], // each uses STALE version=1
      );
      results.push(won);
    }
    const winners = results.filter((r) => r);
    expect(winners).toHaveLength(1);
  });
});
