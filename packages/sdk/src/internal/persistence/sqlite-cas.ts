/**
 * SQLite optimistic compare-and-swap (ADR D83).
 *
 * `casUpdate(db, sql, params, expectedChanges)` executes a prepared
 * UPDATE and returns true if `result.changes === expectedChanges`.
 * Caller provides the full SQL (including `WHERE version = ?` predicate);
 * helper does NOT generate SQL — DRY at the level of "wrap the
 * convention", not "build queries".
 *
 * Use case canonical (Hermes `kanban_db.py:1922-1934`):
 *
 *   const won = casUpdate(
 *     db,
 *     "UPDATE registry SET status = ?, version = version + 1 WHERE id = ? AND version = ?",
 *     ["running", "agent-foo", 3],
 *   );
 *   if (!won) { ... re-read and retry ... }
 *
 * Helper does NOT retry — caller responsible for backoff (avoids hidden
 * loops). Helper does NOT cache prepared statements — `better-sqlite3`
 * caches internally; SDK use is one-shot per mutation, not hot loops.
 *
 * @internal
 */

import type Database from "better-sqlite3";

type DatabaseInstance = InstanceType<typeof Database>;

/**
 * Execute a CAS UPDATE. Returns true iff the actual changes count matches
 * `expectedChanges`. SQL errors (invalid syntax, closed db) propagate.
 *
 * @internal
 */
export function casUpdate(
  db: DatabaseInstance,
  sql: string,
  params: ReadonlyArray<unknown>,
  expectedChanges: number = 1,
): boolean {
  const stmt = db.prepare(sql);
  const result = stmt.run(...(params as unknown[]));
  return result.changes === expectedChanges;
}
