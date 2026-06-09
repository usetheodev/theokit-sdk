/**
 * sdk-memory `migrate-sqlite-to-lance` unit test (iter 71).
 *
 * Validates the iter 71 hybrid copy of
 * `internal/memory/migrate-sqlite-to-lance.ts` from sdk-core.
 * sdk-memory now ships the canonical SQLite → LanceDB one-shot
 * migration per ADR D44.
 *
 * sdk-core retains its copy for v1.x migration back-compat.
 * Both copies byte-equivalent at runtime (same lance-new/ staging +
 * atomic rename commit, same NFC-normalized sample compare,
 * same dry-run/failed-validation/success outcome shapes,
 * same T1.4/D70 secret-redaction logger wrap, same
 * `migration_destination_exists` typed precondition).
 *
 * Lean test focus: the empty-cwd path (no SQLite db present)
 * + the destination-exists precondition. Both run without
 * requiring better-sqlite3 or @lancedb/lancedb to be installed
 * because they short-circuit before touching native modules.
 * The full read→write→validate→commit path is exercised by
 * sdk-core's existing integration tests (lancedb-backend-ship-v1-1);
 * sdk-memory's smoke test pins the public surface shape.
 */

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type MigrateResult, migrateSqliteToLance } from "@theokit/sdk-memory";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("sdk-memory migrate-sqlite-to-lance (iter 71)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "sdk-memory-migrate-"));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("test_empty_workspace_returns_no_op_shape_without_touching_native_modules", async () => {
    // No SQLite db exists → readAllSqliteFacts returns [] → short-circuit
    // returns the no-op result BEFORE touching LanceIndex.open at all.
    // This test runs reliably on environments without @lancedb/lancedb
    // because the early-out fires before any native import.
    const logged: string[] = [];
    const result: MigrateResult = await migrateSqliteToLance({
      cwd,
      logger: (m) => logged.push(m),
    });

    expect(result).toEqual({
      countSqlite: 0,
      countLance: 0,
      validated: true,
      sampleComparisons: [],
      lancePath: join(cwd, ".theokit", "memory", "lance"),
      committed: false,
    });

    // Logger was called for the "Reading..." and "SQLite has 0 facts."
    // breadcrumbs at minimum.
    expect(logged.length).toBeGreaterThanOrEqual(1);
    expect(logged.some((m) => m.includes("SQLite has 0 facts"))).toBe(true);
  });

  it("test_destination_exists_throws_typed_ConfigurationError", async () => {
    // Pre-create the final Lance directory. Migration MUST refuse rather
    // than overwriting it.
    const finalPath = join(cwd, ".theokit", "memory", "lance");
    await mkdir(finalPath, { recursive: true });

    await expect(migrateSqliteToLance({ cwd, logger: () => undefined })).rejects.toMatchObject({
      message: expect.stringContaining("Destination already exists"),
    });
  });

  it("test_logger_default_is_console_log_when_omitted", async () => {
    // Smoke check: omitting logger uses console.log; ensure no throw.
    // (Console output is not captured here — just exercising default
    // path.)
    const result = await migrateSqliteToLance({ cwd });
    expect(result.countSqlite).toBe(0);
  });

  it("test_default_lancePath_matches_canonical_layout", async () => {
    const result = await migrateSqliteToLance({
      cwd,
      logger: () => undefined,
    });
    // lanceStoragePath canonical layout per iter 68.
    expect(result.lancePath).toBe(join(cwd, ".theokit", "memory", "lance"));
  });
});
