/**
 * sdk-memory `index-schema` export smoke test (iter 49).
 *
 * Validates the iter 49 hybrid copy of `internal/memory/index-schema.ts`
 * from sdk-core. sdk-memory now ships the canonical SQL DDL constants
 * that future sqlite-vec/lance index moves (`index-db`, `index-manager`,
 * `vec-index`) will target as siblings.
 *
 * sdk-core retains its copy for v1.x SQLite memory back-compat.
 * Both copies are byte-identical today; semver-major reconciliation
 * happens when Stage 3 source-move completes.
 */

import { PRAGMA_STATEMENTS, SCHEMA_STATEMENTS } from "@theokit/sdk-memory";
import { describe, expect, it } from "vitest";

describe("sdk-memory index-schema (iter 49)", () => {
  it("test_SCHEMA_STATEMENTS_contains_files_chunks_meta_tables", () => {
    const joined = SCHEMA_STATEMENTS.join("\n");
    expect(joined).toContain("CREATE TABLE IF NOT EXISTS files");
    expect(joined).toContain("CREATE TABLE IF NOT EXISTS chunks");
    expect(joined).toContain("CREATE TABLE IF NOT EXISTS meta");
  });

  it("test_SCHEMA_STATEMENTS_includes_chunks_fts_virtual_table", () => {
    const joined = SCHEMA_STATEMENTS.join("\n");
    expect(joined).toContain("CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5");
  });

  it("test_SCHEMA_STATEMENTS_includes_fts_sync_triggers", () => {
    const joined = SCHEMA_STATEMENTS.join("\n");
    expect(joined).toContain("CREATE TRIGGER IF NOT EXISTS chunks_fts_insert");
    expect(joined).toContain("CREATE TRIGGER IF NOT EXISTS chunks_fts_delete");
  });

  it("test_SCHEMA_STATEMENTS_includes_chunks_file_id_index", () => {
    const joined = SCHEMA_STATEMENTS.join("\n");
    expect(joined).toContain("CREATE INDEX IF NOT EXISTS idx_chunks_file_id ON chunks(file_id)");
  });

  it("test_PRAGMA_STATEMENTS_excludes_WAL_per_ADR_D63", () => {
    // ADR D63: WAL is applied separately via applyWalWithFallback so
    // NFS/SMB users get DELETE fallback instead of a crash. The constant
    // array MUST NOT include "PRAGMA journal_mode=WAL".
    const joined = PRAGMA_STATEMENTS.join("\n");
    expect(joined).not.toContain("journal_mode=WAL");
    expect(joined).not.toContain("journal_mode = WAL");
  });

  it("test_PRAGMA_STATEMENTS_includes_synchronous_NORMAL_and_FK_ON", () => {
    expect(PRAGMA_STATEMENTS).toContain("PRAGMA synchronous=NORMAL");
    expect(PRAGMA_STATEMENTS).toContain("PRAGMA foreign_keys=ON");
  });

  it("test_arrays_are_readonly_typed", () => {
    // Constants exposed as ReadonlyArray<string> — TS surface confirms.
    // Runtime check: arrays are present and non-empty.
    expect(Array.isArray(SCHEMA_STATEMENTS)).toBe(true);
    expect(Array.isArray(PRAGMA_STATEMENTS)).toBe(true);
    expect(SCHEMA_STATEMENTS.length).toBeGreaterThan(0);
    expect(PRAGMA_STATEMENTS.length).toBeGreaterThan(0);
  });
});
