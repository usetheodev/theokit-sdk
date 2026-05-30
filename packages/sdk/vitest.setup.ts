/**
 * Vitest autouse setup (T6.1, ADR D60; secret-redaction-discipline EC-3 fix).
 *
 * Three responsibilities:
 *
 * 0. **Top-level (once per worker):** Run native bindings preflight
 *    (`dogfood-regressions-fix-plan` T1.1). Detects NODE_MODULE_VERSION
 *    mismatch on better-sqlite3 + auto-rebuilds before any test loads it.
 *    See: ../../tools/preflight-native-bindings.mjs + CLAUDE.md > "Native
 *    bindings discipline".
 *
 * 1. (beforeEach) Isolates `THEOKIT_HOME` per-test in a fresh tmpdir.
 *    Prevents tests from writing into the developer's real `~/.theokit/`
 *    or the project `.theokit/`. Restores the original env value after
 *    each test so explicit overrides inside a test are honored within the
 *    test body.
 *
 * 2. (beforeEach) Resets the redact module's `_extraPatterns` list and
 *    re-enables redaction between tests. Without this, a test that calls
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

// dogfood-regressions-fix-plan v1.1 T1.1 — top-level preflight.
// Top-level await is supported in vitest setupFiles (ESM context). If it
// fails (e.g., rebuild blew up), it `process.exit(1)` with an actionable
// message before any test loads.
import { ensureNativeBindings } from "../../tools/preflight-native-bindings.mjs";

// Import directly from the canonical module (not via the `_test-reset.ts`
// re-export shim) to avoid any possibility of a separate module instance
// between setup and tests when path-resolvers normalize differently.
import { _resetForTests } from "./src/internal/security/redact.js";

await ensureNativeBindings();

let tempHome: string | undefined;
let originalTheokitHome: string | undefined;
// dogfood-regressions-fix-plan v1.1 — tests that touch user-personality /
// user-config lookup (`~/.theokit/personalities/`, etc.) set `process.env.HOME`
// to a tmpdir. Without isolation across tests, parallel workers race the
// shared env and a test sees another test's HOME mid-run. Pre-fix: this was
// masked because the sqlite suite consumed worker slots serially; post-fix
// (preflight T1.1), parallelism is healthy and the race surfaces. Isolate
// HOME the same way THEOKIT_HOME is isolated — save + restore per-test.
let originalHome: string | undefined;

beforeEach(() => {
  originalTheokitHome = process.env.THEOKIT_HOME;
  originalHome = process.env.HOME;
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
  if (originalTheokitHome === undefined) {
    delete process.env.THEOKIT_HOME;
  } else {
    process.env.THEOKIT_HOME = originalTheokitHome;
    originalTheokitHome = undefined;
  }
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
    originalHome = undefined;
  }
});
