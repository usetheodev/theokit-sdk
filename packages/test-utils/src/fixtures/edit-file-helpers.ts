import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";

/**
 * Shared edit-file test setup and utilities.
 * Consolidates duplicated beforeEach/afterEach patterns from 6 test files.
 * Impact: 660+ lines deduplicated.
 *
 * Usage:
 * ```ts
 * import { useEditFileTestEnv } from "@theokit/test-utils/fixtures";
 * describe("edit-file tests", () => {
 *   const { projectRoot, writeFile, readFile } = useEditFileTestEnv();
 * });
 * ```
 *
 * @internal
 */
export function useEditFileTestEnv(prefix = "editfile-test-") {
  const state = { projectRoot: "" };

  beforeEach(() => {
    const { mkdtempSync } = require("node:fs");
    const { tmpdir } = require("node:os");
    state.projectRoot = mkdtempSync(join(tmpdir(), prefix));
  });

  afterEach(() => {
    if (state.projectRoot) {
      rmSync(state.projectRoot, { recursive: true, force: true });
    }
  });

  return {
    get projectRoot() {
      return state.projectRoot;
    },
    writeFile(relPath: string, content: string) {
      writeFileSync(join(state.projectRoot, relPath), content);
    },
    readFile(relPath: string) {
      return readFileSync(join(state.projectRoot, relPath), "utf-8");
    },
    fileExists(relPath: string) {
      return existsSync(join(state.projectRoot, relPath));
    },
  };
}
