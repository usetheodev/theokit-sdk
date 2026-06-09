#!/usr/bin/env node
/**
 * SDK 2.0 Phase 7 cohort analysis — enumerate packages depending
 * on `@theokit/sdk` (or `@theokit/sdk-core` after Phase 6) + report
 * the cohort bump payload.
 *
 * After Phase 6 renames sdk → sdk-core + bumps to 2.0.0, every
 * dependent package needs its peerDep updated. Phase 7 is the
 * cohort publish that ships these bumps together.
 *
 * Usage:
 *   node scripts/phase7-cohort-analysis.mjs
 *
 * Output:
 *   - JSON report on stdout: list of { package, version, sdkRef }
 *     for every workspace package consuming sdk-core.
 *   - Human-readable summary on stderr: per-package state + total.
 *
 * Exit code:
 *   0 — clean run
 *   1 — invocation error
 *
 * Iter 84 (Phase 7 prep). Pre-flight tool. Does NOT modify anything.
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

// Either pre-Phase-6 spec or post-Phase-6 spec (after iter 81/83 rename).
const SDK_KEYS = ["@theokit/sdk", "@theokit/sdk-core"];

const cohort = [];

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
      await inspect_package(full);
    }
  }
}

async function inspect_package(path) {
  let content;
  try {
    content = await readFile(path, "utf8");
  } catch {
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return;
  }
  // Skip the sdk-core package itself — we're enumerating CONSUMERS.
  if (parsed.name === "@theokit/sdk" || parsed.name === "@theokit/sdk-core") {
    return;
  }

  const refs = [];
  for (const block of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const deps = parsed[block];
    if (!deps || typeof deps !== "object") continue;
    for (const sdkKey of SDK_KEYS) {
      const v = deps[sdkKey];
      if (v !== undefined && v !== null) {
        refs.push({ block, key: sdkKey, version: String(v) });
      }
    }
  }
  if (refs.length === 0) return;

  cohort.push({
    package: parsed.name ?? "(unknown)",
    version: parsed.version ?? "(unversioned)",
    path: relative(REPO_ROOT, path),
    isWorkspace: refs.some((r) =>
      r.version.startsWith("workspace:") || r.version.startsWith("file:"),
    ),
    refs,
  });
}

function printSummary() {
  const consumers = cohort.length;
  const workspace = cohort.filter((c) => c.isWorkspace).length;
  const external = consumers - workspace;
  const peer = cohort.filter((c) =>
    c.refs.some((r) => r.block === "peerDependencies"),
  ).length;

  console.error("# Phase 7 cohort analysis");
  console.error(`\nConsumers found: ${consumers}`);
  console.error(`  - Workspace links (file:/workspace:): ${workspace}`);
  console.error(`  - External version pins:              ${external}`);
  console.error(`  - With peerDependencies:              ${peer}`);

  // Group by block + version for at-a-glance state.
  const versionsByBlock = new Map();
  for (const c of cohort) {
    for (const r of c.refs) {
      const key = `${r.block}::${r.key}::${r.version}`;
      versionsByBlock.set(key, (versionsByBlock.get(key) ?? 0) + 1);
    }
  }
  console.error("\n## Version spec histogram");
  const sorted = [...versionsByBlock.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  for (const [key, count] of sorted) {
    console.error(`  ${count.toString().padStart(3, " ")}  ${key}`);
  }

  console.error("\n## Per-package detail (top 25)");
  for (const c of cohort.slice(0, 25)) {
    console.error(`  ${c.package} @ ${c.version}`);
    for (const r of c.refs) {
      console.error(`    - ${r.block}.${r.key} = "${r.version}"`);
    }
  }
  if (cohort.length > 25) {
    console.error(`  ... and ${cohort.length - 25} more`);
  }
}

async function main() {
  await walk(REPO_ROOT);
  // JSON to stdout for machine consumption.
  console.log(JSON.stringify(cohort, null, 2));
  // Human report to stderr.
  printSummary();
}

main().catch((err) => {
  console.error("cohort-analysis failed:", err);
  process.exit(1);
});
