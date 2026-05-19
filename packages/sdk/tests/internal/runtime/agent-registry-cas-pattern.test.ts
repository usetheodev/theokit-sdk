/**
 * Integration demo: `casUpdate` against a hypothetical agent-registry SQLite
 * schema (T3.6, ADR D83).
 *
 * Demonstrates that the canonical pattern from Hermes' `kanban_db.py`
 * (`UPDATE ... WHERE id = ? AND version = ?`) yields exactly one winner
 * under concurrent racers. The current agent-registry uses JSON +
 * `withFileLock`; this test serves as the recommended pattern for any
 * future migration to SQLite (out of scope for this plan).
 */

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { casUpdate } from "../../../src/internal/persistence/sqlite-cas.js";

describe("agent-registry CAS pattern (T3.6)", () => {
  type DB = InstanceType<typeof Database>;
  let db: DB;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE agent_registry_cas (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        version INTEGER NOT NULL
      );
    `);
    db.prepare("INSERT INTO agent_registry_cas (id, status, version) VALUES (?, ?, ?)").run(
      "agent-foo",
      "ready",
      1,
    );
  });

  afterEach(() => {
    db.close();
  });

  it("racing CAS update: exactly one winner among 10 attempts with stale version", () => {
    // Each "racer" reads version=1 and tries to update.
    const results: boolean[] = [];
    for (let i = 0; i < 10; i++) {
      const won = casUpdate(
        db,
        "UPDATE agent_registry_cas SET status = ?, version = version + 1 WHERE id = ? AND version = ?",
        [`running-${i}`, "agent-foo", 1],
      );
      results.push(won);
    }
    const winners = results.filter((r) => r);
    expect(winners).toHaveLength(1);

    const final = db
      .prepare("SELECT status, version FROM agent_registry_cas WHERE id = ?")
      .get("agent-foo") as { status: string; version: number };
    expect(final.version).toBe(2); // exactly one increment
  });

  it("retry-loop after race loss: eventually succeeds", () => {
    // Simulate: process A wins first, process B reads stale, retries with
    // fresh version, succeeds.
    const wonA = casUpdate(
      db,
      "UPDATE agent_registry_cas SET status = ?, version = version + 1 WHERE id = ? AND version = ?",
      ["running-A", "agent-foo", 1],
    );
    expect(wonA).toBe(true);

    // Process B's first attempt fails (stale)
    const wonB1 = casUpdate(
      db,
      "UPDATE agent_registry_cas SET status = ?, version = version + 1 WHERE id = ? AND version = ?",
      ["running-B", "agent-foo", 1], // STALE version
    );
    expect(wonB1).toBe(false);

    // Process B re-reads + retries with fresh version=2
    const fresh = db
      .prepare("SELECT version FROM agent_registry_cas WHERE id = ?")
      .get("agent-foo") as { version: number };
    const wonB2 = casUpdate(
      db,
      "UPDATE agent_registry_cas SET status = ?, version = version + 1 WHERE id = ? AND version = ?",
      ["running-B", "agent-foo", fresh.version],
    );
    expect(wonB2).toBe(true);
  });
});
