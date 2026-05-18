/**
 * Vitest autouse setup (T6.1, ADR D60; secret-redaction-discipline EC-3 fix).
 *
 * Two responsibilities, one beforeEach hook:
 *
 * 1. Isolates `THEOKIT_HOME` per-test in a fresh tmpdir. Prevents tests from
 *    writing into the developer's real `~/.theokit/` or the project
 *    `.theokit/`. Restores the original env value after each test so
 *    explicit overrides inside a test are honored within the test body.
 *
 * 2. Resets the redact module's `_extraPatterns` list and re-enables
 *    redaction between tests. Without this, a test that calls
 *    `Security.addPattern(...)` would pollute every subsequent test in the
 *    same vitest worker; a test that disables redaction would leak the
 *    disabled state into siblings.
 *
 * @internal
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach } from "vitest";

// Import directly from the canonical module (not via the `_test-reset.ts`
// re-export shim) to avoid any possibility of a separate module instance
// between setup and tests when path-resolvers normalize differently.
import { _resetForTests } from "./src/internal/security/redact.js";

let tempHome: string | undefined;
let originalEnv: string | undefined;

beforeEach(() => {
  originalEnv = process.env.THEOKIT_HOME;
  tempHome = mkdtempSync(join(tmpdir(), "theokit-test-"));
  process.env.THEOKIT_HOME = tempHome;
  // Secret-redaction EC-3: clear user-added patterns + force ON.
  _resetForTests({ enabled: true, clearExtras: true });
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
