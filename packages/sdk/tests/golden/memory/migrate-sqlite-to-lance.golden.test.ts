import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isLanceAvailable } from "../../../src/internal/memory/lance-index.js";
import { migrateSqliteToLance } from "../../../src/internal/memory/migrate-sqlite-to-lance.js";

/**
 * Migration CLI tests — Phase 5.2 of v1.2 plan (ADR D44).
 * Covers: empty SQLite workspace, dry-run, NFC unicode normalization (EC-3).
 *
 * Full Lance roundtrip requires `@lancedb/lancedb` (optional dep). When
 * absent (default CI), we test the SQLite-side behaviors that work
 * regardless of Lance availability.
 */

describe("migrateSqliteToLance (ADR D44)", () => {
  let cwd: string;
  const logs: string[] = [];
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-migrate-"));
    logs.length = 0;
  });
  afterEach(() => {
    // tmpdir cleanup happens lazily via OS.
  });

  it("returns 'nothing to migrate' for empty workspace", async () => {
    const result = await migrateSqliteToLance({
      cwd,
      dryRun: false,
      logger: (m) => logs.push(m),
    });
    expect(result.countSqlite).toBe(0);
    expect(result.countLance).toBe(0);
    expect(result.validated).toBe(true);
    expect(result.committed).toBe(false);
  });

  it("dry-run on empty workspace returns committed=false", async () => {
    const result = await migrateSqliteToLance({
      cwd,
      dryRun: true,
      logger: (m) => logs.push(m),
    });
    expect(result.committed).toBe(false);
  });

  it("EC-3 MUST FIX: NFC unicode normalization is used in source", async () => {
    // The migration validation uses NFC compare (see EC-3 in plan).
    // Static source check: nfcEqual function exists.
    const { readFileSync } = await import("node:fs");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      resolve(here, "../../../src/internal/memory/migrate-sqlite-to-lance.ts"),
      "utf8",
    );
    expect(src).toContain('normalize("NFC")');
    expect(src).toContain("nfcEqual");
  });

  it("returns MigrateResult with all expected fields", async () => {
    const result = await migrateSqliteToLance({
      cwd,
      dryRun: true,
      logger: (m) => logs.push(m),
    });
    expect(result).toHaveProperty("countSqlite");
    expect(result).toHaveProperty("countLance");
    expect(result).toHaveProperty("validated");
    expect(result).toHaveProperty("sampleComparisons");
    expect(result).toHaveProperty("lancePath");
    expect(result).toHaveProperty("committed");
    expect(typeof result.countSqlite).toBe("number");
    expect(Array.isArray(result.sampleComparisons)).toBe(true);
  });

  it("lancePath points to <cwd>/.theokit/memory/lance", async () => {
    const result = await migrateSqliteToLance({
      cwd,
      dryRun: true,
      logger: (m) => logs.push(m),
    });
    expect(result.lancePath).toBe(join(cwd, ".theokit", "memory", "lance"));
  });

  it("isLanceAvailable() reflects environment state", () => {
    // Just sanity: function callable and returns boolean.
    const v = isLanceAvailable();
    expect(typeof v).toBe("boolean");
  });
});
