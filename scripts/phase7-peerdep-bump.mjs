#!/usr/bin/env node
/**
 * SDK 2.0 Phase 7 peerDep bump tool — update `@theokit/sdk-core` peer
 * version constraints to match the new 2.0.0 major.
 *
 * Phase 6 (iter 81 + 83) mechanically renames `@theokit/sdk` →
 * `@theokit/sdk-core` in every package.json. That preserves the
 * version constraint verbatim — so a package with
 * `peerDependencies: { "@theokit/sdk": ">=1.7.0" }` becomes
 * `peerDependencies: { "@theokit/sdk-core": ">=1.7.0" }` post-Phase-6.
 * That's WRONG: sdk-core is now at 2.0.0 and the old constraint
 * doesn't match anymore.
 *
 * Phase 7 fixes the version. Default target constraint: `^2.0.0`.
 * Operators override via `--target <spec>` if they want a different
 * range.
 *
 * Usage:
 *   node scripts/phase7-peerdep-bump.mjs                       # dry-run, target ^2.0.0
 *   node scripts/phase7-peerdep-bump.mjs --target ">=2.0.0"    # custom target
 *   node scripts/phase7-peerdep-bump.mjs --write               # apply
 *   node scripts/phase7-peerdep-bump.mjs --write --backup      # apply + .bak
 *
 * Scope:
 *   - Only updates `peerDependencies` blocks.
 *   - Skips `workspace:` and `file:` specs (those resolve to the
 *     workspace package directly + don't need updating).
 *   - Skips sdk-core's own package.json (it doesn't depend on itself).
 *
 * Exit code:
 *   0 — clean run
 *   1 — invocation error
 *
 * Iter 85 (Phase 7 prep #2).
 */

import { readFile, readdir, writeFile, copyFile, stat } from "node:fs/promises";
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

const args = process.argv.slice(2);
const WRITE_MODE = args.includes("--write");
const BACKUP = args.includes("--backup");
const TARGET_IDX = args.indexOf("--target");
const TARGET =
  TARGET_IDX >= 0 && args[TARGET_IDX + 1] !== undefined
    ? args[TARGET_IDX + 1]
    : "^2.0.0";

const summary = [];

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
      await inspect_pkg(full);
    }
  }
}

async function inspect_pkg(path) {
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
  } catch {
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return;
  }

  if (parsed.name === "@theokit/sdk" || parsed.name === "@theokit/sdk-core") {
    return;
  }

  const peer = parsed.peerDependencies;
  if (!peer || typeof peer !== "object") return;

  const changes = [];
  for (const key of ["@theokit/sdk", "@theokit/sdk-core"]) {
    const current = peer[key];
    if (current === undefined || current === null) continue;
    const currentStr = String(current);
    if (currentStr.startsWith("workspace:") || currentStr.startsWith("file:")) {
      continue;
    }
    if (currentStr === TARGET) continue;
    changes.push({ key, from: currentStr, to: TARGET });
    peer[key] = TARGET;
  }

  if (changes.length === 0) return;

  const rel = relative(REPO_ROOT, path);
  summary.push({
    package: parsed.name ?? "(unknown)",
    path: rel,
    changes,
  });

  if (WRITE_MODE) {
    if (BACKUP) await copyFile(path, `${path}.bak`);
    await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`);
  }
}

function printReport() {
  console.log("# Phase 7 peerDep bump tool report");
  console.log(`Mode: ${WRITE_MODE ? "WRITE" : "DRY-RUN"}${BACKUP ? " (with .bak backups)" : ""}`);
  console.log(`Target version constraint: ${TARGET}`);
  console.log("");
  if (summary.length === 0) {
    console.log("No peerDependencies need updating.");
    return;
  }
  console.log(`## Packages affected (${summary.length})`);
  for (const item of summary) {
    console.log(`  ${item.package}  (${item.path})`);
    for (const c of item.changes) {
      console.log(`    - peerDependencies.${c.key}: "${c.from}" → "${c.to}"`);
    }
  }
  console.log(
    `\n## Summary: ${summary.length} packages ${WRITE_MODE ? "modified" : "would be modified"}.`,
  );
  if (!WRITE_MODE) {
    console.log("\nThis was a dry-run. Re-run with `--write` to apply changes.");
    console.log("Override target with `--target \"<spec>\"` (default ^2.0.0).");
  }
}

async function main() {
  await walk(REPO_ROOT);
  printReport();
}

main().catch((err) => {
  console.error("phase7-peerdep-bump failed:", err);
  process.exit(1);
});
