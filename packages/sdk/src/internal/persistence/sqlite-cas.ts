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
 * NOTE — no internal-visibility tag in this block. `tsconfig.base.json` sets `stripInternal: true`,
 * and TypeScript scans EVERY leading comment range of the declaration that follows, including the
 * import right below this one. The tag that used to sit here deleted that import from the emitted
 * `.d.ts`, leaving the types it binds unresolvable for any consumer running type-aware lint
 * (usetheodev/theokit-sdk#283 records the same trap on a declaration).
 */

import type Database from "better-sqlite3";

type DatabaseInstance = InstanceType<typeof Database>;

/**
 * Run an UPDATE and report whether it changed exactly the number of rows you expected — the
 * optimistic-concurrency equivalent of taking a lock.
 *
 * `sql` is yours, in full, including the guard that makes it a compare-and-swap: the
 * `WHERE ... AND version = ?` predicate and the `SET version = version + 1` that closes it. This
 * function generates nothing. It prepares the statement, runs it with `params`, and compares
 * `changes` against `expectedChanges` (default 1).
 *
 * `false` means the guard did not match — someone else moved the row first, or the id does not
 * exist. Those two are indistinguishable here; if you need to tell them apart, re-read the row.
 * A `false` return means NOTHING was written, so the caller owns the re-read-and-retry, with
 * whatever backoff it wants. There is no retry loop hidden in here, by design.
 *
 * SQL errors propagate — bad syntax, a closed database, a constraint violation, a busy writer.
 * Only the row-count mismatch is reported as `false`.
 *
 * Runs as a single implicit transaction, so no explicit BEGIN is needed for one statement. Wrap
 * the call yourself when the swap has to commit together with other writes.
 *
 * **Choosing between this and the locks.** `casUpdate` never blocks and never waits: the loser
 * finds out immediately and decides what to do. Prefer it when the contended state is already a
 * row with a version column. When the contended state is a FILE, there is no version column to
 * swap on — use `withFileLock` across processes, or `withCwdMutex` within one. When the goal is
 * to create something exactly once rather than update it, `createExclusive` is the primitive.
 *
 * Semver-exempt: reachable via the `@theokit/sdk/internal/persistence` sub-path, which the package
 * declares in `exports` but does NOT cover with its semver contract.
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
