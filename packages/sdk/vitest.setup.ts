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

// theokit-sdk-biome-cleanup 2026-05-30 — fix HOME-race root cause.
//
// Previous setup used module-level `let originalHome` to save+restore HOME
// per-test. When vitest parallelizes (worker threads OR async test scheduling
// inside a single process), test A's beforeEach saves HOME=X into the module
// var, then test B's beforeEach overwrites it with HOME=Y, then test A's
// afterEach restores HOME=Y instead of X — corrupting the env for every
// subsequent test that reads it (5 tests under
// internal/{providers/discovery,runtime/context-import-resolver,personality/*}
// failed deterministically under load).
//
// The fix is a STACK keyed by test-instance (vitest passes the test context
// to beforeEach/afterEach with a stable `task.id` over a single test). Push
// the original env values on entry; pop on exit. Concurrent tests get
// independent entries.
interface SetupBackup {
  tempHome: string;
  originalTheokitHome: string | undefined;
  originalHome: string | undefined;
}
const backupByTask = new Map<string, SetupBackup>();

beforeEach((ctx) => {
  const tempHome = mkdtempSync(join(tmpdir(), "theokit-test-"));
  backupByTask.set(ctx.task.id, {
    tempHome,
    originalTheokitHome: process.env.THEOKIT_HOME,
    originalHome: process.env.HOME,
  });
  process.env.THEOKIT_HOME = tempHome;
  // Secret-redaction EC-3: clear user-added patterns + force ON.
  _resetForTests({ enabled: true, clearExtras: true });
});

afterEach((ctx) => {
  const backup = backupByTask.get(ctx.task.id);
  if (backup === undefined) return;
  backupByTask.delete(ctx.task.id);
  rmSync(backup.tempHome, { recursive: true, force: true });
  if (backup.originalTheokitHome === undefined) {
    delete process.env.THEOKIT_HOME;
  } else {
    process.env.THEOKIT_HOME = backup.originalTheokitHome;
  }
  if (backup.originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = backup.originalHome;
  }
});
