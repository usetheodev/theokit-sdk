#!/usr/bin/env node
/**
 * SDK 2.0 pre-publish validation gate — workspace invariants that
 * MUST hold before the cohort publish (Step 6 of the runbook).
 *
 * Checks:
 *   1. Every package.json parses cleanly.
 *   2. After Phase 6: no leftover bare `@theokit/sdk` reference
 *      anywhere in package.json files (sub-packages with `-` are
 *      allowed). Pre-Phase-6: any state passes.
 *   3. sdk-core's package.json has the expected `name`
 *      (`@theokit/sdk-core` after rename; `@theokit/sdk` before).
 *   4. sdk-core version is consistent with sub-package peer
 *      constraints — if sdk-core says 2.0.0, sub-packages must say
 *      `^2.0.0` (or `>=2.0.0`); if sdk-core says 1.x, sub-packages
 *      must say `>=1.x.x` (or whatever the matching range is).
 *   5. No package.json contains `"workspace:"` AND `"file:"` for the
 *      same dep (catches a copy-paste editing accident).
 *
 * Usage:
 *   node scripts/sdk-2-0-pre-publish-check.mjs
 *
 * Exit code:
 *   0 — all gates pass
 *   1 — at least one gate failed; details printed
 *
 * Iter 87 — release gate. Operators run this AFTER Phase 6 + 7
 * mechanical mutations (iter 83 + 85) and BEFORE pnpm install +
 * cohort publish (runbook Step 4-6).
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".turbo",
  ".changeset",
  "coverage",
  ".vitest-cache",
  ".pnpm-store",
]);

const failures = [];
const packages = []; // collected workspace packages
let sdkCorePkg = null;
let sdkLegacyPkg = null;

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "EACCES" || err.code === "ENOENT") return;
    throw err;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && !entry.name.startsWith(".changeset")) {
      if (entry.name !== ".github") continue;
    }
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full);
    } else if (entry.isFile() && entry.name === "package.json") {
      await inspect(full);
    }
  }
}

async function inspect(path) {
  let stats;
  try {
    stats = await stat(path);
  } catch {
    return;
  }
  if (stats.size > 1_000_000) return;
  let content;
  try {
    content = await readFile(path, "utf8");
  } catch (err) {
    failures.push({
      gate: "package-json-parse",
      path: relative(REPO_ROOT, path),
      detail: `read failed: ${(err && err.message) || err}`,
    });
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    failures.push({
      gate: "package-json-parse",
      path: relative(REPO_ROOT, path),
      detail: `JSON.parse failed: ${(err && err.message) || err}`,
    });
    return;
  }

  packages.push({ path: relative(REPO_ROOT, path), parsed });

  if (parsed.name === "@theokit/sdk-core") {
    sdkCorePkg = { path: relative(REPO_ROOT, path), parsed };
  } else if (parsed.name === "@theokit/sdk") {
    sdkLegacyPkg = { path: relative(REPO_ROOT, path), parsed };
  }
}

function depBlocks(parsed) {
  const out = [];
  for (const block of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const deps = parsed[block];
    if (deps && typeof deps === "object") {
      out.push({ block, deps });
    }
  }
  return out;
}

function check_no_legacy_sdk_when_renamed() {
  // Only relevant when Phase 6 has run (sdk-core exists).
  if (sdkCorePkg === null) return;

  for (const pkg of packages) {
    for (const { block, deps } of depBlocks(pkg.parsed)) {
      if (deps["@theokit/sdk"] !== undefined && deps["@theokit/sdk"] !== null) {
        failures.push({
          gate: "no-legacy-sdk-after-rename",
          path: pkg.path,
          detail: `${block}.@theokit/sdk = "${deps["@theokit/sdk"]}" — Phase 6 missed this entry`,
        });
      }
    }
  }
}

function check_sdk_core_name_matches_state() {
  // EITHER sdk-core exists (post-Phase-6) OR sdk-legacy exists
  // (pre-Phase-6). Both is a bug (both packages can't coexist with
  // the same files).
  if (sdkCorePkg !== null && sdkLegacyPkg !== null) {
    failures.push({
      gate: "sdk-core-name-state",
      path: "(workspace)",
      detail: `Both @theokit/sdk (${sdkLegacyPkg.path}) and @theokit/sdk-core (${sdkCorePkg.path}) exist — Phase 6 incomplete or conflicting`,
    });
  }
}

function semver_major(version) {
  if (typeof version !== "string") return null;
  const match = /^(\d+)\./.exec(version);
  return match === null ? null : Number(match[1]);
}

function spec_major(spec) {
  if (typeof spec !== "string") return null;
  // ^X, ~X, >=X, X.x, etc.
  const match = /(?:^|[^\d])(\d+)\./.exec(spec);
  return match === null ? null : Number(match[1]);
}

function check_peer_version_consistency() {
  const corePkg = sdkCorePkg ?? sdkLegacyPkg;
  if (corePkg === null) return;
  const coreMajor = semver_major(corePkg.parsed.version);
  if (coreMajor === null) return;

  const targetName = sdkCorePkg !== null ? "@theokit/sdk-core" : "@theokit/sdk";

  for (const pkg of packages) {
    if (pkg === corePkg) continue;
    const peer = pkg.parsed.peerDependencies;
    if (!peer || typeof peer !== "object") continue;
    const spec = peer[targetName];
    if (spec === undefined || spec === null) continue;
    const specStr = String(spec);
    if (specStr.startsWith("workspace:") || specStr.startsWith("file:")) {
      continue;
    }
    const peerMajor = spec_major(specStr);
    if (peerMajor === null) continue;
    if (peerMajor !== coreMajor) {
      failures.push({
        gate: "peer-version-consistency",
        path: pkg.path,
        detail: `${targetName} version major mismatch: pkg pins "${specStr}" (major ${peerMajor}) but sdk-core is at ${corePkg.parsed.version} (major ${coreMajor})`,
      });
    }
  }
}

function check_no_mixed_workspace_file_specs() {
  for (const pkg of packages) {
    for (const { block, deps } of depBlocks(pkg.parsed)) {
      const sdkSpec = deps["@theokit/sdk"] ?? deps["@theokit/sdk-core"];
      if (sdkSpec === undefined) continue;
      const specStr = String(sdkSpec);
      const hasWorkspace = specStr.startsWith("workspace:");
      const hasFile = specStr.startsWith("file:");
      // Belt-and-suspenders: the spec field itself can't be both,
      // but if a sibling block has a different style for the same
      // key, that's the bug.
      const blockSiblings = depBlocks(pkg.parsed).filter((b) => b.block !== block);
      for (const sib of blockSiblings) {
        const otherSpec = sib.deps["@theokit/sdk"] ?? sib.deps["@theokit/sdk-core"];
        if (otherSpec === undefined) continue;
        const otherStr = String(otherSpec);
        const otherWs = otherStr.startsWith("workspace:");
        const otherFile = otherStr.startsWith("file:");
        if ((hasWorkspace && otherFile) || (hasFile && otherWs)) {
          failures.push({
            gate: "no-mixed-workspace-file",
            path: pkg.path,
            detail: `${block} uses "${specStr}" but ${sib.block} uses "${otherStr}" — pick one style`,
          });
          break;
        }
      }
    }
  }
}

function printReport() {
  console.log("# SDK 2.0 pre-publish validation gate");
  console.log("");
  console.log(`Workspace packages scanned: ${packages.length}`);
  if (sdkCorePkg !== null) {
    console.log(
      `sdk-core: ${sdkCorePkg.parsed.name} @ ${sdkCorePkg.parsed.version} (${sdkCorePkg.path})`,
    );
  }
  if (sdkLegacyPkg !== null) {
    console.log(
      `sdk legacy: ${sdkLegacyPkg.parsed.name} @ ${sdkLegacyPkg.parsed.version} (${sdkLegacyPkg.path})`,
    );
  }

  if (failures.length === 0) {
    console.log("\n## Result: PASS — all gates green.");
    return;
  }

  console.log(`\n## Result: FAIL — ${failures.length} gate violations.`);
  const byGate = new Map();
  for (const f of failures) {
    if (!byGate.has(f.gate)) byGate.set(f.gate, []);
    byGate.get(f.gate).push(f);
  }
  for (const [gate, list] of byGate.entries()) {
    console.log(`\n### Gate: ${gate} (${list.length})`);
    for (const f of list.slice(0, 30)) {
      console.log(`  ${f.path}: ${f.detail}`);
    }
    if (list.length > 30) {
      console.log(`  ... and ${list.length - 30} more`);
    }
  }
}

async function main() {
  await walk(REPO_ROOT);
  check_sdk_core_name_matches_state();
  check_no_legacy_sdk_when_renamed();
  check_peer_version_consistency();
  check_no_mixed_workspace_file_specs();
  printReport();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("pre-publish-check failed:", err);
  process.exit(1);
});
