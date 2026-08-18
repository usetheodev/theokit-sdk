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
  it("test_subpath_resolves_at_import_time", () => {
    // B-061. The body used to be `expect(true).toBe(true)` under the reasoning "reaching this line
    // means the resolution succeeded". True but incomplete: a sub-path can resolve while the barrel
    // behind it drops a symbol, and this file's own docblock says it pins that "the expected
    // primitives are exported". Every name in the import list above is asserted defined here, so
    // losing one fails at the sub-path test rather than silently in whichever extracted package
    // consumes it.
    const exported = {
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
    };

    const missing = Object.entries(exported)
      .filter(([, value]) => value === undefined)
      .map(([name]) => name);

    expect(missing, "every primitive the sub-path promises must resolve").toEqual([]);
  });

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
