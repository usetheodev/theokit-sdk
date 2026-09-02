import { describe, expect, it } from "vitest";

import { ConfigurationError } from "../../../src/errors.js";
import { migrateSqliteToLance } from "../../../src/internal/memory/migrate-sqlite-to-lance.js";

/**
 * The migration loop is `for (let i = 0; i < facts.length; i += batchSize)`, and every bad batchSize
 * broke it differently and silently:
 *
 *  - 0 or negative — `i` never advances past the guard, so the migration SPINS FOREVER, calling
 *    `addFacts([])` and logging "Migrated x/y"per iteration. A hang that looks like work.
 *  - NaN — the guard is false on the first check, zero facts move, and the caller is told
 *    "Validation FAILED. SQLite preserved.": a typo in a flag reported as a migration failure.
 *
 * The CLI that surfaced this validates its own flag with a message naming the value. These cases pin
 * the guard in the LIBRARY, which is what a programmatic caller reaches — and what survives if the
 * CLI wrapper is ever removed.
 *
 * `cwd` points at a directory that does not exist on purpose: the guard must refuse BEFORE anything
 * touches the filesystem, so a passing case here would fail on the missing workspace instead.
 */
describe("migrateSqliteToLance refuses a batchSize its loop cannot advance with", () => {
  const cwd = "/nonexistent-workspace-for-the-batch-size-guard";

  it.each([
    0,
    -1,
    -100,
    Number.NaN,
    2.5,
    Number.POSITIVE_INFINITY,
  ])("refuses %p before touching the workspace", async (batchSize) => {
    await expect(migrateSqliteToLance({ cwd, batchSize })).rejects.toMatchObject({
      name: "ConfigurationError",
      code: "invalid_batch_size",
    });
  });

  it("names the value it received, so the caller can see the typo", async () => {
    await expect(migrateSqliteToLance({ cwd, batchSize: 0 })).rejects.toThrow(/received 0/);
  });

  it("is typed, so a caller can branch on it", async () => {
    await expect(migrateSqliteToLance({ cwd, batchSize: -1 })).rejects.toBeInstanceOf(
      ConfigurationError,
    );
  });

  it("lets an omitted batchSize through — the default is applied downstream", async () => {
    // It RESOLVES, and that is the proof it got past the guard: a workspace with no SQLite index is
    // "nothing to migrate", not an error. Measured rather than assumed — this case was written
    // expecting a rejection from the missing directory, and the migration reports zero counts
    // instead.
    await expect(migrateSqliteToLance({ cwd })).resolves.toMatchObject({ countSqlite: 0 });
  });
});
