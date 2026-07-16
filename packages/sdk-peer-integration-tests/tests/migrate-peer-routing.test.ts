/**
 * SDK 2.0 Phase 4 Stage 4 #3 — `migrateSqliteToLance` peer routing
 * test (iter 78).
 *
 * Validates that the public `migrateSqliteToLance` wrapper routes
 * through `@theokit/sdk-memory` when the peer is installed, falling
 * back to the legacy internal implementation when absent.
 *
 * The "peer absent" branch can't be exercised here (workspace has
 * sdk-memory installed); the legacy code path is preserved
 * structurally + verified by iter 71's sdk-memory copy + sdk-core's
 * existing migrate tests against the unchanged internal.
 *
 * Tests focus on the no-legacy-json no-op result + the
 * destination-exists precondition error — both short-circuit before
 * touching native modules, so they run on any Node + ABI.
 */

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateSqliteToLance } from "@theokit/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("sdk-core migrateSqliteToLance peer routing (iter 78, Phase 4 #3)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "sdk-migrate-routing-"));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("test_no_legacy_json_returns_no_op_shape", async () => {
    // Routes through peer; peer's iter 71 implementation short-circuits
    // when no SQLite db exists, returning the canonical no-op shape.
    const result = await migrateSqliteToLance({
      cwd,
      logger: () => undefined,
    });
    expect(result.countSqlite).toBe(0);
    expect(result.countLance).toBe(0);
    expect(result.validated).toBe(true);
    expect(result.sampleComparisons).toEqual([]);
    expect(result.committed).toBe(false);
    expect(result.lancePath).toBe(join(cwd, ".theokit", "memory", "lance"));
  });

  it("test_destination_exists_throws_typed_error_through_peer_path", async () => {
    // Pre-create the final Lance destination — peer's iter 71 copy
    // throws `migration_destination_exists`. The same error message
    // shape is preserved through the routing wrapper.
    const finalPath = join(cwd, ".theokit", "memory", "lance");
    await mkdir(finalPath, { recursive: true });

    await expect(migrateSqliteToLance({ cwd, logger: () => undefined })).rejects.toMatchObject({
      message: expect.stringContaining("Destination already exists"),
    });
  });

  it("test_logger_breadcrumbs_flow_through_peer_routing", async () => {
    const logged: string[] = [];
    await migrateSqliteToLance({
      cwd,
      logger: (m) => logged.push(m),
    });
    // Iter 71 emits at least the "Reading SQLite facts" + "SQLite has 0 facts"
    // breadcrumbs even on the no-op path. The wrapper passes the logger
    // through unchanged so we can observe.
    expect(logged.length).toBeGreaterThanOrEqual(1);
    expect(logged.some((m) => m.includes("SQLite has 0 facts"))).toBe(true);
  });

  it("test_default_lance_path_canonical_layout", async () => {
    const result = await migrateSqliteToLance({
      cwd,
      logger: () => undefined,
    });
    expect(result.lancePath).toBe(join(cwd, ".theokit", "memory", "lance"));
  });
});
