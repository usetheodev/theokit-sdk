/**
 * `@theokit/sdk/internal/persistence` sub-path export smoke test
 * (SDK 2.0 Phase 1 physical Stage 3 prep — iter 32).
 *
 * Per the plan's T1.1 EC-1: sdk-core MUST declare `./internal/persistence`
 * in its `exports` field so extracted packages (sdk-memory, sdk-budget,
 * etc.) can `import` persistence primitives without sdk-core duplication.
 *
 * Without this sub-path, Node ESM blocks consumers with
 * `ERR_PACKAGE_PATH_NOT_EXPORTED`.
 *
 * This test pins:
 *   - The sub-path resolves at import time (no module-resolution error).
 *   - The expected primitives are exported (withCwdMutex,
 *     atomicWriteJson, withFileLock, etc.) — these are what Stage 3
 *     source-move requires for sdk-memory's rich impl.
 */

import {
  atomicWriteJson,
  atomicWriteText,
  casUpdate,
  containsCjk,
  createExclusive,
  displayTheokitHome,
  getProfilesRoot,
  getTheokitHome,
  migrateSchema,
  PersistenceSchema,
  readVersionedJson,
  replaceFileAtomic,
  sanitizeFts5Query,
  withCwdMutex,
  withFileLock,
  writeVersionedJson,
} from "@theokit/sdk/internal/persistence";
import { describe, expect, expectTypeOf, it } from "vitest";

describe("@theokit/sdk/internal/persistence sub-path (Stage 3 prep — iter 32)", () => {
  // B-061. This file used to open with `test_subpath_resolves_at_import_time`, whose body was
  // `expect(true).toBe(true)`. The repair replaced it with a presence check over all 16 imported
  // names — and review showed every one of those names is already asserted, more strongly
  // (`typeof === "function"`), by the seven tests below. Dropping a symbol from the barrel fails
  // `test_sqlite_helpers_exported` and its siblings, not silently. The test case was therefore
  // redundant in both forms and is gone; the module-level import above is what proves the sub-path
  // resolves, and it runs before any test in this file.

  it("test_cwd_mutex_exported_for_extracted_packages", () => {
    expect(typeof withCwdMutex).toBe("function");
    // Signature: <T>(key, fn) => Promise<T>
    expectTypeOf(withCwdMutex).toBeFunction();
  });

  it("test_atomic_write_primitives_exported", () => {
    expect(typeof atomicWriteJson).toBe("function");
    expect(typeof atomicWriteText).toBe("function");
    expect(typeof replaceFileAtomic).toBe("function");
  });

  it("test_file_lock_exported", () => {
    expect(typeof withFileLock).toBe("function");
    expect(typeof createExclusive).toBe("function");
  });

  it("test_versioned_json_helpers_exported", () => {
    expect(typeof readVersionedJson).toBe("function");
    expect(typeof writeVersionedJson).toBe("function");
    expect(typeof migrateSchema).toBe("function");
    expect(PersistenceSchema).toBeDefined();
  });

  it("test_path_helpers_exported", () => {
    expect(typeof getTheokitHome).toBe("function");
    expect(typeof getProfilesRoot).toBe("function");
    expect(typeof displayTheokitHome).toBe("function");
  });

  it("test_fts5_helpers_exported", () => {
    expect(typeof sanitizeFts5Query).toBe("function");
    expect(typeof containsCjk).toBe("function");
  });

  it("test_sqlite_helpers_exported", () => {
    expect(typeof casUpdate).toBe("function");
  });
});
