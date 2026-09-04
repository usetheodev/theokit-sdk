import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";

/**
 * Shared temporary directory setup for tests.
 * Consolidates 692+ duplicated mkdtemp patterns across test suites.
 *
 * Usage:
 * ```ts
 * import { useTempDirectory } from "@theokit/test-utils/fixtures";
 *
 * describe("my test", () => {
 *   const { cwd } = useTempDirectory("my-test-");
 *   // cwd.value is the temporary directory path
 * });
 * ```
 */
export function useTempDirectory(prefix = "theo-test-") {
  const state = { value: "" };

  beforeEach(async () => {
    state.value = await mkdtemp(join(tmpdir(), prefix));
  });

  afterEach(async () => {
    if (state.value) {
      // Race condition: SDK may persist files asynchronously. Rather than
      // fail the suite on teardown issues unrelated to the test, leave
      // orphaned dirs for OS cleanup. See agent-describe.test.ts for context.
      try {
        await rm(state.value, { recursive: true, force: true });
      } catch {
        // Ignored — orphan is better than test failure
      }
    }
  });

  return state as Readonly<{ value: string }>;
}

/**
 * Manual mkdtemp — when you need direct control over temp directory lifecycle.
 * Consolidates repeated `mkdtemp(join(tmpdir(), prefix))` patterns.
 */
export async function createTempDirectory(prefix = "theo-test-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/**
 * Synchronous temp file write — consolidates repeated file I/O in test setup.
 */
export async function writeTestFile(
  dir: string,
  filename: string,
  content: string,
): Promise<string> {
  const path = join(dir, filename);
  await writeFile(path, content, "utf-8");
  return path;
}
