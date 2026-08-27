/**
 * Vitest autouse setup (T6.1, ADR D60; secret-redaction-discipline EC-3 fix).
 *
 * Four responsibilities:
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
 * 3. (beforeEach) B-117 — clears the process-wide agent registry (a `Map`
 *    keyed by `agentId`, module-level state in
 *    `src/internal/runtime/registry/agent-registry.ts`). `THEOKIT_HOME`
 *    isolation does NOT touch this Map: it lives for the life of the worker
 *    process, so an agent registered by one test was still enumerable by the
 *    next `Agent.list()` in the same file — a probe measured 5 → 8 agents
 *    across tests in one file before this reset existed. Individual test
 *    files used to call `clearAgentRegistry()` by hand in their own
 *    `beforeEach`/`afterEach`, which only isolates the files that remembered
 *    to. This makes it unconditional, the same way THEOKIT_HOME isolation
 *    already is (responsibility 1 above) — one seam, not N per-file opt-ins.
 *
 * @internal
 */

import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
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
import { setDiagnosticsSink } from "./src/internal/diagnostics.js";
import { _resetForTests } from "./src/internal/security/redact.js";

// B-117 — `agent-registry.js` is imported LAZILY: the `import()` call itself
// lives INSIDE the `beforeEach` callback below, not at this file's top level —
// a `const p = import(...)` assigned here would start loading just as eagerly
// as a static `import` statement, since evaluation begins the moment `import()`
// is called, not when its promise is awaited.
//
// A static (or eagerly-called) import here pulls in `agent-registry-store.js`
// -> `schema-version.js` -> `atomic-write.js` -> `node:crypto`, and evaluates
// that chain as part of THIS setup file's own top-level load — which runs
// before a test file's `vi.mock("node:crypto", ...)` has a chance to intercept
// it. `atomic-write.ts` then caches the REAL `randomBytes`, and any test that
// mocks crypto to make its temp-file suffix predictable
// (`tests/internal/persistence/atomic-write-exclusive.test.ts`) silently stops
// matching production's actual temp path. Measured: with an eager import here
// (static, or a top-level `import()` call), that file's two residue-collision
// tests both broke — one resolved instead of rejecting, the other left a
// leftover `.tmp` file — while passing in isolation on every other
// configuration. Calling `import()` only once `beforeEach` actually runs defers
// the chain until after the test file's own mock hoisting has been registered.

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

beforeEach(async (ctx) => {
  const tempHome = mkdtempSync(join(tmpdir(), "theokit-test-"));
  backupByTask.set(ctx.task.id, {
    tempHome,
    originalTheokitHome: process.env.THEOKIT_HOME,
    originalHome: process.env.HOME,
  });
  process.env.THEOKIT_HOME = tempHome;
  // B-120 — HOME was backed up (see `originalHome` above and the restore in
  // `afterEach` below) but never actually SET, so any module that reads
  // `process.env.HOME` / `os.homedir()` directly instead of consulting
  // `THEOKIT_HOME` resolved to the developer's REAL `~`. Measured 2026-08-19:
  // `~/.theokit/mcp-tokens.json` held 6 fixture keys and its mtime advanced
  // twice during one afternoon of test runs. B-090 fixed the one module that
  // exploited this (the MCP token store); this closes the gap itself so the
  // NEXT home-anchored module — present or future — cannot repeat it. Reuses
  // the same `tempHome` as THEOKIT_HOME rather than a second tmpdir: nothing
  // needs HOME and THEOKIT_HOME to diverge, and one sandbox root per test is
  // simpler to reason about than two.
  process.env.HOME = tempHome;
  // …but NOT corepack's package-manager cache. That cache lives under `$HOME/.cache/node/corepack`,
  // so redirecting HOME hides it, and any test that spawns `pnpm` gets a corepack with nothing
  // cached — which sends it to the network to resolve `packageManager`, where Node 22.12.0's
  // bundled npm-registry signing key no longer matches the one npm signs with:
  //
  //   Error: Cannot find matching keyid … at fetchLatestStableVersion
  //
  // Measured 2026-08-26 against `tests/publish-workspace-guard.test.ts`, which packs a real package
  // with the real `pnpm` on purpose (pnpm is the tool under test there and cannot be pinned). It
  // failed only under the parallel run and passed alone, which read as flakiness and was not.
  //
  // The isolation above exists so the SDK cannot write to the developer's real home. A downloaded
  // package manager is not SDK state, so losing it was collateral rather than intent — this points
  // corepack back at the real cache without giving anything else the real HOME. An operator who
  // already set `COREPACK_HOME` keeps their value.
  process.env.COREPACK_HOME ??= join(
    backupByTask.get(ctx.task.id)?.originalHome ?? homedir(),
    ".cache",
    "node",
    "corepack",
  );
  // Secret-redaction EC-3: clear user-added patterns + force ON.
  _resetForTests({ enabled: true, clearExtras: true });
  // B-117: process-wide agent registry Map does not follow THEOKIT_HOME — reset it too.
  // Imported here (lazily) rather than at file top level — see the comment above.
  const { clearAgentRegistry, invalidateRegistryHydration } = await import(
    "./src/internal/runtime/registry/agent-registry.js"
  );
  clearAgentRegistry();
  invalidateRegistryHydration();
  // theokit#147 — diagnostics are SILENT by default in production. 36 test files assert a given
  // condition emits a warning by spying on `process.stderr.write`, and that contract is real. This
  // forwards the channel to stderr for the duration of each test so those assertions keep testing
  // what they always tested, through the same channel a host installs. A test that wants to observe
  // the production default clears the sink itself.
  setDiagnosticsSink((message) => {
    process.stderr.write(message);
  });
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
