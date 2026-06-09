#!/usr/bin/env node
/**
 * SDK 2.0 Phase 6 dry-run — `@theokit/sdk` → `@theokit/sdk-core` rename.
 *
 * Walks the workspace and reports every file that would be touched
 * by the actual rename, WITHOUT modifying anything. Operators run
 * this BEFORE the real rename to validate scope + catch surprises.
 *
 * Usage:
 *   node scripts/phase6-rename-dry-run.mjs
 *
 * Exit code:
 *   0 — clean dry-run; report printed
 *   1 — invocation error or filesystem error
 *
 * Counts by category:
 *   - workspace_package_json — package.json files declaring @theokit/sdk
 *     in any dependency block; rename target = field value
 *   - source_import          — *.ts / *.tsx / *.mts / *.cts files with
 *     literal "@theokit/sdk" import specifier (not "@theokit/sdk-*")
 *   - documentation         — *.md files mentioning @theokit/sdk
 *
 * Iter 81 (Phase 6 prep). The actual rename is a separate operator
 * step requiring coordinated cohort publish — this script is the
 * pre-flight check.
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

// Matches @theokit/sdk but NOT @theokit/sdk-* (negative lookahead).
const SDK_SPEC_RE = /@theokit\/sdk(?!-)/g;

const summary = {
  workspace_package_json: [],
  source_import: [],
  documentation: [],
};

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
      // Skip hidden except .changeset which we already covered in SKIP_DIRS.
      if (entry.name !== ".github") continue;
    }
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full);
    } else if (entry.isFile()) {
      await inspect(full);
    }
  }
}

async function inspect(path) {
  const rel = relative(REPO_ROOT, path);
  const basename = rel.split("/").pop() ?? "";
  const ext = basename.includes(".") ? basename.slice(basename.lastIndexOf(".")) : "";

  // Skip large or binary by extension first.
  const TEXT_EXT = new Set([
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".mjs",
    ".cjs",
    ".json",
    ".md",
    ".yml",
    ".yaml",
  ]);
  if (!TEXT_EXT.has(ext)) return;

  let stats;
  try {
    stats = await stat(path);
  } catch {
    return;
  }
  // Skip files > 1 MB to keep dry-run fast.
  if (stats.size > 1_000_000) return;

  let content;
  try {
    content = await readFile(path, "utf8");
  } catch {
    return;
  }

  if (basename === "package.json") {
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      return;
    }
    const matched = [];
    for (const block of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      const deps = parsed[block];
      if (deps && typeof deps === "object") {
        if (
          deps["@theokit/sdk"] !== undefined &&
          deps["@theokit/sdk"] !== null
        ) {
          matched.push(`${block}.@theokit/sdk = "${deps["@theokit/sdk"]}"`);
        }
      }
    }
    // Also catch package.json's own name (the package being renamed).
    if (parsed.name === "@theokit/sdk") {
      matched.push('name = "@theokit/sdk"');
    }
    if (matched.length > 0) {
      summary.workspace_package_json.push({ path: rel, matches: matched });
    }
    return;
  }

  if (
    ext === ".ts" ||
    ext === ".tsx" ||
    ext === ".mts" ||
    ext === ".cts" ||
    ext === ".js" ||
    ext === ".mjs" ||
    ext === ".cjs"
  ) {
    const matches = content.match(SDK_SPEC_RE);
    if (matches !== null) {
      summary.source_import.push({ path: rel, count: matches.length });
    }
    return;
  }

  if (ext === ".md") {
    const matches = content.match(SDK_SPEC_RE);
    if (matches !== null) {
      summary.documentation.push({ path: rel, count: matches.length });
    }
    return;
  }
}

function printReport() {
  const sectionHeader = (label, items) => {
    console.log(`\n## ${label} (${items.length} files)`);
    if (items.length === 0) {
      console.log("(none)");
      return;
    }
    // Cap report at 50 rows per section to keep output sane.
    const CAP = 50;
    for (const item of items.slice(0, CAP)) {
      if (item.matches !== undefined) {
        console.log(`  ${item.path}`);
        for (const m of item.matches) console.log(`    - ${m}`);
      } else {
        console.log(`  ${item.path}  (${item.count} hits)`);
      }
    }
    if (items.length > CAP) {
      console.log(`  ... and ${items.length - CAP} more`);
    }
  };

  console.log("# Phase 6 rename dry-run report");
  console.log("\nReplacement: `@theokit/sdk` → `@theokit/sdk-core`");
  console.log("(matches do NOT include `@theokit/sdk-memory`, `-budget`, etc.)");

  sectionHeader("package.json declarations", summary.workspace_package_json);
  sectionHeader("source import specifiers", summary.source_import);
  sectionHeader("documentation references", summary.documentation);

  const total =
    summary.workspace_package_json.length +
    summary.source_import.length +
    summary.documentation.length;
  console.log(`\n## Summary: ${total} files would be touched.`);
}

async function main() {
  await walk(REPO_ROOT);
  printReport();
}

main().catch((err) => {
  console.error("dry-run failed:", err);
  process.exit(1);
});
