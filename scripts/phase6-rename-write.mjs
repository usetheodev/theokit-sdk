#!/usr/bin/env node
/**
 * SDK 2.0 Phase 6 write tool — `@theokit/sdk` → `@theokit/sdk-core` rename.
 *
 * Companion to iter 81's `phase6-rename-dry-run.mjs`. This script
 * MUTATES the working tree. ALWAYS run the dry-run script first
 * to verify scope.
 *
 * Usage:
 *   node scripts/phase6-rename-write.mjs              # dry-run (default — same as iter 81 tool)
 *   node scripts/phase6-rename-write.mjs --write      # apply changes
 *   node scripts/phase6-rename-write.mjs --write --backup
 *                                                     # apply + create .bak per modified file
 *
 * Exit code:
 *   0 — clean run; report printed
 *   1 — invocation error or filesystem error
 *
 * Substitutions applied:
 *   1. package.json: rename key `@theokit/sdk` → `@theokit/sdk-core` in
 *      dependencies / devDependencies / peerDependencies /
 *      optionalDependencies. Also rename the package's own
 *      `name: "@theokit/sdk"` → `name: "@theokit/sdk-core"`.
 *   2. *.ts/.tsx/.mts/.cts/.js/.mjs/.cjs source files: regex replace
 *      `@theokit/sdk(?!-)` → `@theokit/sdk-core`.
 *   3. *.md documentation: same regex replace as source files.
 *
 * Negative-lookahead `(?!-)` ensures `@theokit/sdk-memory`,
 * `@theokit/sdk-budget`, etc. are NEVER touched.
 *
 * Iter 83 (Phase 6 prep #2). The actual sdk-core version bump to
 * 2.0.0 is a separate operator step — this tool only handles the
 * mechanical name + import-string rewrite.
 */

import { readFile, readdir, stat, writeFile, copyFile } from "node:fs/promises";
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

const args = process.argv.slice(2);
const WRITE_MODE = args.includes("--write");
const BACKUP = args.includes("--backup");

const summary = {
  package_json_modified: [],
  source_modified: [],
  documentation_modified: [],
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
      if (entry.name !== ".github") continue;
    }
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full);
    } else if (entry.isFile()) {
      await process_file(full);
    }
  }
}

async function process_file(path) {
  const rel = relative(REPO_ROOT, path);
  const basename = rel.split("/").pop() ?? "";
  const ext = basename.includes(".") ? basename.slice(basename.lastIndexOf(".")) : "";

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
  ]);
  if (!TEXT_EXT.has(ext)) return;

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

  if (basename === "package.json") {
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      return;
    }
    const changes = [];
    // Rename the package's own name.
    if (parsed.name === "@theokit/sdk") {
      parsed.name = "@theokit/sdk-core";
      changes.push('name renamed to "@theokit/sdk-core"');
    }
    // Rename dep keys.
    for (const block of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      const deps = parsed[block];
      if (deps && typeof deps === "object" && deps["@theokit/sdk"] !== undefined) {
        const value = deps["@theokit/sdk"];
        delete deps["@theokit/sdk"];
        // Preserve ordering by re-inserting in sorted block order is
        // overkill; just append the renamed entry. pnpm doesn't care.
        deps["@theokit/sdk-core"] = value;
        changes.push(`${block} key @theokit/sdk → @theokit/sdk-core`);
      }
      // Rename peerDependenciesMeta key too.
    }
    if (parsed.peerDependenciesMeta && typeof parsed.peerDependenciesMeta === "object") {
      const meta = parsed.peerDependenciesMeta;
      if (meta["@theokit/sdk"] !== undefined) {
        const value = meta["@theokit/sdk"];
        delete meta["@theokit/sdk"];
        meta["@theokit/sdk-core"] = value;
        changes.push("peerDependenciesMeta key @theokit/sdk → @theokit/sdk-core");
      }
    }
    if (changes.length > 0) {
      summary.package_json_modified.push({ path: rel, changes });
      if (WRITE_MODE) {
        if (BACKUP) await copyFile(path, `${path}.bak`);
        await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`);
      }
    }
    return;
  }

  // Source files + markdown — regex replace.
  if (SDK_SPEC_RE.test(content)) {
    SDK_SPEC_RE.lastIndex = 0; // reset stateful global regex
    const next = content.replace(SDK_SPEC_RE, "@theokit/sdk-core");
    const hitCount = (content.match(SDK_SPEC_RE) ?? []).length;
    SDK_SPEC_RE.lastIndex = 0;
    const bucket = ext === ".md" ? summary.documentation_modified : summary.source_modified;
    bucket.push({ path: rel, count: hitCount });
    if (WRITE_MODE) {
      if (BACKUP) await copyFile(path, `${path}.bak`);
      await writeFile(path, next);
    }
  }
}

function printReport() {
  const section = (label, items) => {
    console.log(`\n## ${label} (${items.length} files)`);
    if (items.length === 0) {
      console.log("(none)");
      return;
    }
    const CAP = 80;
    for (const item of items.slice(0, CAP)) {
      if (item.changes !== undefined) {
        console.log(`  ${item.path}`);
        for (const c of item.changes) console.log(`    - ${c}`);
      } else {
        console.log(`  ${item.path}  (${item.count} hits)`);
      }
    }
    if (items.length > CAP) {
      console.log(`  ... and ${items.length - CAP} more`);
    }
  };

  console.log("# Phase 6 rename write tool report");
  console.log(`Mode: ${WRITE_MODE ? "WRITE" : "DRY-RUN"}${BACKUP ? " (with .bak backups)" : ""}`);
  console.log("Replacement: `@theokit/sdk` → `@theokit/sdk-core`");
  console.log("(matches do NOT include `@theokit/sdk-memory`, `-budget`, etc.)");

  section("package.json modifications", summary.package_json_modified);
  section("source file modifications", summary.source_modified);
  section("documentation modifications", summary.documentation_modified);

  const total =
    summary.package_json_modified.length +
    summary.source_modified.length +
    summary.documentation_modified.length;
  console.log(`\n## Summary: ${total} files ${WRITE_MODE ? "modified" : "would be modified"}.`);

  if (!WRITE_MODE && total > 0) {
    console.log("\nThis was a dry-run. Re-run with `--write` to apply changes.");
    console.log("Recommended: `--write --backup` to preserve .bak copies.");
  }
}

async function main() {
  await walk(REPO_ROOT);
  printReport();
}

main().catch((err) => {
  console.error("rename-write failed:", err);
  process.exit(1);
});
