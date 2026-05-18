/**
 * Vitest autouse setup (T6.1, ADR D60).
 *
 * Isolates `THEOKIT_HOME` per-test in a fresh tmpdir. Prevents tests from
 * writing into the developer's real `~/.theokit/` or the project `.theokit/`.
 * Restores the original env value after each test so explicit overrides
 * inside a test are honored within the test body.
 *
 * @internal
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach } from "vitest";

let tempHome: string | undefined;
let originalEnv: string | undefined;

beforeEach(() => {
  originalEnv = process.env.THEOKIT_HOME;
  tempHome = mkdtempSync(join(tmpdir(), "theokit-test-"));
  process.env.THEOKIT_HOME = tempHome;
});

afterEach(() => {
  if (tempHome !== undefined) {
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = undefined;
  }
  if (originalEnv === undefined) {
    delete process.env.THEOKIT_HOME;
  } else {
    process.env.THEOKIT_HOME = originalEnv;
    originalEnv = undefined;
  }
});
