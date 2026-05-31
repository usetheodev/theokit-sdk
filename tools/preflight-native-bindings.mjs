#!/usr/bin/env node
// dogfood-regressions-fix-plan v1.1 — T1.1: Native bindings preflight.
//
// Auto-detects NODE_MODULE_VERSION mismatch on native deps (currently:
// better-sqlite3) and auto-rebuilds them via `pnpm rebuild`. One-shot per
// session via sentinel cache. Fail-fast in CI (CI=true) — CI must run an
// explicit `pnpm rebuild` step instead of relying on this preflight.
//
// Wired in: packages/sdk/vitest.setup.ts (top of file, before any THEOKIT_HOME
// isolation). Runs once at vitest startup.
//
// Why this exists:
//   pnpm only WARNS on engines.node mismatch; bindings get compiled for
//   whatever Node was active at install-time. Later runs with a different
//   Node throw `Module did not self-register` or `NODE_MODULE_VERSION X
//   required, got Y`. Pre-fix, 39 SDK tests (memory/persistence/registry-cas)
//   silently failed because this binding path was broken.
//
// See: theokit-sdk/CLAUDE.md > "Native bindings discipline" (T4.1).

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(__dirname, "..");

// ADD new native deps here when shipped. Auto-discovery (scan
// node_modules/**/binding.gyp) rejected as YAGNI per plan EC-6.
//
// Each dep MUST have a matching `exerciseDep` case. Optional peer deps
// (e.g. @lancedb/lancedb) are skipped gracefully when not installed.
const NATIVE_DEPS = ["better-sqlite3", "@lancedb/lancedb"];

// Peers that are optional — preflight skips them when absent from
// node_modules instead of failing. Required deps (better-sqlite3) are
// expected to be present and MUST_NOT be in this list.
const OPTIONAL_PEERS = new Set(["@lancedb/lancedb"]);

// EC-1 manifesting empirically: `packages/sdk/node_modules/better-sqlite3` is
// a SYMLINK to `../../../theokit/node_modules/.pnpm/better-sqlite3@.../...`.
// Probing from `theokit-sdk/package.json` resolves to a DIFFERENT path than
// what tests load. We must probe from each package that consumes the dep.
//
// Probing roots: the package paths that have a `node_modules/<dep>` entry
// (real or symlinked). Order matters: SDK package first (most-likely test
// path), then workspace root as fallback.
const PROBE_ROOTS = [resolve(WORKSPACE_ROOT, "packages/sdk"), WORKSPACE_ROOT];

const SENTINEL_DIR = resolve(WORKSPACE_ROOT, "node_modules/.cache");

/**
 * EC-2 (lancedb-backend-ship-v1-1 plan): sentinel filename encodes the SORTED
 * list of peers actually probed in this run. When peer state changes between
 * runs (e.g. dev installs @lancedb/lancedb after a prior run), the sentinel
 * filename differs → cache miss → full probe re-runs. Without this,
 * peer-presence transitions cause stale sentinels that silently pass.
 *
 * Filename grammar: `preflight-native-<abi>[-<peer1>+<peer2>+...].ok`
 * Peer names are slug-safe (`@/` → `_`).
 */
function sentinelPath(abi, peersProbed) {
  if (peersProbed.length === 0) {
    return resolve(SENTINEL_DIR, `preflight-native-${abi}.ok`);
  }
  const slug = peersProbed
    .slice()
    .sort()
    .map((p) => p.replace(/[/@]/g, "_"))
    .join("+");
  return resolve(SENTINEL_DIR, `preflight-native-${abi}-${slug}.ok`);
}

/**
 * Returns true when the dep is resolvable from any PROBE_ROOT. Used to
 * gate optional peers (@lancedb/lancedb) — absent peers are skipped
 * instead of failing the preflight.
 */
function isPeerInstalled(dep) {
  for (const root of PROBE_ROOTS) {
    try {
      const req = createRequire(resolve(root, "package.json"));
      req.resolve(dep);
      return true;
    } catch {
      // not in this root — try next
    }
  }
  return false;
}

// EC-2 MUST FIX: 5 min covers cold builds on low-end / CI free-tier / ARM.
const REBUILD_TIMEOUT_MS = 300_000;

function isAbiError(err) {
  if (err === null || err === undefined) return false;
  const msg = String(err.message ?? err);
  const cause = err.cause !== undefined ? String(err.cause.message ?? err.cause) : "";
  return /NODE_MODULE_VERSION|did not self-register|was compiled against/.test(`${msg} ${cause}`);
}

async function probeRequire(dep) {
  // Probe each known root. A root that doesn't have the dep installed
  // (MODULE_NOT_FOUND) is skipped — not all roots consume every native dep.
  // An ABI error at any root = real failure; route rebuild via findRebuildCwd
  // using the binding path that surfaced.
  //
  // CRITICAL: many native-deps export a JS wrapper that DEFERS dlopen until
  // first use (e.g., `better-sqlite3` only dlopens when `new Database(...)`
  // is called). Just `req(dep)` succeeds without exercising the binding.
  // We must DRIVE the dep into actually loading its .node file. The
  // exerciseDep() function below has a per-dep hook for this.
  let lastNotFound;
  for (const root of PROBE_ROOTS) {
    try {
      // Fresh createRequire per call — avoids module cache hiding stale state
      // between probes (e.g., after rebuild we MUST re-probe with cleared cache).
      const req = createRequire(resolve(root, "package.json"));
      const resolved = req.resolve(dep);
      // Clear from cache if previously loaded (best-effort)
      delete req.cache?.[resolved];
      const mod = req(dep);
      await exerciseDep(dep, mod);
    } catch (error) {
      if (error?.code === "MODULE_NOT_FOUND") {
        lastNotFound = error;
        continue; // try next root
      }
      return {
        ok: false,
        error,
        bindingPath: extractBindingPath(error),
        probeRoot: root,
      };
    }
  }
  // If we got here with lastNotFound but no actual probe succeeded, the dep
  // isn't installed anywhere we expected — treat as OK (nothing to rebuild).
  // The downstream test that imports it would fail with the same error,
  // surfacing the real issue (missing install).
  return { ok: true, missing: lastNotFound !== undefined };
}

/**
 * Per-dep no-op exercise that forces the dlopen of the native binding.
 * Called once per probe to ensure ABI mismatches surface.
 *
 * For `better-sqlite3`: `new Database(':memory:').close()` instantiates the
 * binding, then closes immediately. Negligible cost (<5ms).
 *
 * If you add a new entry to NATIVE_DEPS, add the exercise here too. A dep
 * with NO exercise will silently pass the probe even if its binding is
 * broken (we'd only catch it at test-time, defeating the preflight).
 */
async function exerciseDep(dep, mod) {
  switch (dep) {
    case "better-sqlite3": {
      const Database = mod.default ?? mod;
      const db = new Database(":memory:");
      db.close();
      return;
    }
    case "@lancedb/lancedb": {
      // Lance loads its NAPI binding at require-time, so just requiring is
      // usually enough to trigger ABI mismatch. We belt-and-suspenders by
      // calling `connect()` against an ephemeral tmpdir to ensure the full
      // .node entry-point executes. EC-D1: tmpdir failure is non-fatal —
      // log warn + continue (real recall would still surface ABI errors).
      let tmpDir;
      try {
        tmpDir = mkdtempSync(join(tmpdir(), "lance-preflight-"));
      } catch (cause) {
        process.stderr.write(
          `[preflight-native-bindings] Lance probe: mkdtemp failed (${cause?.message ?? cause}). Skipping deep probe — first real Memory.recall will surface any ABI mismatch as a typed error.\n`,
        );
        return;
      }
      try {
        const conn = await mod.connect(tmpDir);
        // No close() needed — Lance auto-closes on GC. Force tableNames()
        // to exercise the binding's I/O surface.
        await conn.tableNames();
      } finally {
        try {
          rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          /* ignore cleanup errors */
        }
      }
      return;
    }
    default:
      throw new Error(
        `[preflight-native-bindings] No exercise() defined for native dep '${dep}'. Add a case in exerciseDep() to drive the binding's dlopen.`,
      );
  }
}

function extractBindingPath(err) {
  // Parse error message for the .node binary path. Format examples:
  //   "The module '.../better-sqlite3/build/Release/better_sqlite3.node'"
  //   "Module did not self-register: '.../better_sqlite3.node'"
  const msg = `${String(err.message ?? err)} ${String(err.cause?.message ?? "")}`;
  const m = msg.match(/['"]([^'"]+\.node)['"]/);
  return m ? m[1] : undefined;
}

/**
 * EC-1 MUST FIX (T1.2-shared): when the failing binding lives under a
 * workspace-link symlink, `pnpm rebuild` from the local cwd does NOT cross
 * the symlink boundary. Resolve real path of binding + walk up to the
 * containing repo root.
 *
 * Idempotent: returns defaultCwd if the binding is local (no symlink hop).
 */
export function findRebuildCwd(failingBindingPath, defaultCwd) {
  if (failingBindingPath === undefined) return defaultCwd;
  let real;
  try {
    real = realpathSync(failingBindingPath);
  } catch {
    return defaultCwd;
  }
  // Match: /path/to/repo/node_modules/.pnpm/<pkg>@<ver>/...
  const m = real.match(/^(.+)\/node_modules\/\.pnpm\/[^/]+@[^/]+\//);
  return m !== null ? m[1] : defaultCwd;
}

function runRebuild(dep, bindingPath) {
  const cwd = findRebuildCwd(bindingPath, WORKSPACE_ROOT);
  process.stderr.write(
    `[preflight-native-bindings] Rebuilding '${dep}' in ${cwd} (Node ${process.versions.node}, ABI ${process.versions.modules})...\n`,
  );
  const result = spawnSync("pnpm", ["rebuild", dep], {
    stdio: "inherit",
    shell: false,
    cwd,
    timeout: REBUILD_TIMEOUT_MS,
  });
  return { exitCode: result.status, signal: result.signal, error: result.error };
}

function formatActionableError(dep, err, currentNode) {
  const RED = "\x1b[31m";
  const BOLD = "\x1b[1m";
  const DIM = "\x1b[2m";
  const RESET = "\x1b[0m";
  return [
    "",
    `${RED}${BOLD}[preflight-native-bindings] Failed to rebuild '${dep}' for Node ${currentNode}.${RESET}`,
    "",
    `${DIM}Original error:${RESET} ${err.message ?? err}`,
    "",
    `${DIM}This usually means:${RESET}`,
    `  1. node-gyp prerequisites missing (python3, make, C++ compiler)`,
    `  2. Node version below engines.node floor (>=22.12.0)`,
    "",
    `${DIM}Fix:${RESET}`,
    `  pnpm rebuild ${dep}             # manual retry`,
    `  nvm use                         # switch to .nvmrc Node version`,
    `  nvm install                     # if you don't have it`,
    "",
    "See: CLAUDE.md > 'Native bindings discipline' section.",
    "",
  ].join("\n");
}

/**
 * Handle a single native dep that failed probeRequire. Refactored out of
 * ensureNativeBindings to keep that function below the complexity-10 cap
 * (D422). Returns true if the dep was successfully rebuilt (caller should
 * throw the dlopen-cache restart error); false if the dep was fine and no
 * action was needed (probe ok branch — caller can skip).
 */
function recoverNativeDep(dep, result, inCi) {
  // Unknown error (not ABI) — surface immediately, don't try to rebuild.
  if (!isAbiError(result.error)) {
    throw result.error;
  }

  if (inCi) {
    process.stderr.write(formatActionableError(dep, result.error, process.versions.node));
    process.stderr.write(
      "\n[preflight-native-bindings] CI=true — skipping auto-rebuild. Workflow must ship an explicit `pnpm rebuild` step (T4.2).\n",
    );
    process.exit(1);
  }

  const rebuild = runRebuild(dep, result.bindingPath);
  if (rebuild.exitCode !== 0) {
    process.stderr.write(
      `\n[preflight-native-bindings] pnpm rebuild exited with code ${rebuild.exitCode}${rebuild.signal !== null ? ` (signal ${rebuild.signal})` : ""}.\n`,
    );
    process.stderr.write(
      formatActionableError(dep, rebuild.error ?? result.error, process.versions.node),
    );
    process.exit(1);
  }
}

export async function ensureNativeBindings() {
  // CI fail-fast: CI workflows ship an explicit `pnpm rebuild` step before
  // tests (T4.2). If we still get an ABI mismatch in CI, build prerequisites
  // are missing on the runner — preflight cannot auto-recover.
  const inCi = process.env.CI === "true" || process.env.CI === "1";

  // EC-2: compute peers ACTUALLY probable this run (filter out optional
  // peers absent from node_modules). Sentinel filename encodes the sorted
  // list — when peer state changes between runs, the filename differs.
  const depsToProbe = NATIVE_DEPS.filter((dep) => {
    if (!OPTIONAL_PEERS.has(dep)) return true;
    return isPeerInstalled(dep);
  });
  const sentinel = sentinelPath(process.versions.modules, depsToProbe);

  if (existsSync(sentinel)) return;

  for (const dep of depsToProbe) {
    const result = await probeRequire(dep);
    if (result.ok) continue;

    recoverNativeDep(dep, result, inCi);

    // Node.js dlopen has a cache that survives even after a binary file is
    // replaced on disk. The failed dlopen at first probe leaves a corrupt
    // entry; re-probing in the SAME process yields the same "Module did not
    // self-register" error even though disk binary is now fresh. We trust
    // the rebuild succeeded (gyp exit 0), write the sentinel, and signal
    // the caller (vitest setupFile) to abort cleanly with a clear message
    // so the developer re-runs and the next invocation hits the sentinel.
    mkdirSync(SENTINEL_DIR, { recursive: true });
    writeFileSync(
      sentinel,
      `${new Date().toISOString()} Node ${process.versions.node} ABI ${process.versions.modules} (rebuilt) peers=${depsToProbe.join(",")}\n`,
    );
    throw new Error(
      `[preflight-native-bindings] '${dep}' rebuilt successfully for Node ${process.versions.node}. ` +
        "Node's dlopen cache requires a process restart to load the fresh binding. " +
        "Re-run your command — subsequent runs will hit the sentinel fast-path and proceed cleanly.",
    );
  }

  mkdirSync(SENTINEL_DIR, { recursive: true });
  writeFileSync(
    sentinel,
    `${new Date().toISOString()} Node ${process.versions.node} ABI ${process.versions.modules} peers=${depsToProbe.join(",")}\n`,
  );
}

// Allow direct invocation: `node tools/preflight-native-bindings.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  ensureNativeBindings().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
