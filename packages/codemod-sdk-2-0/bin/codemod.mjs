#!/usr/bin/env node
/**
 * @theokit/codemod-sdk-2-0 — downstream consumer migration tool.
 *
 * Rewrites `@theokit/sdk` → `@theokit/sdk-core` in:
 *   - package.json (dep block keys + name field)
 *   - Source files (*.ts/.tsx/.mts/.cts/.js/.mjs/.cjs imports)
 *   - Markdown (*.md mentions)
 *
 * Negative-lookahead `@theokit/sdk(?!-)` ensures sub-packages
 * (`@theokit/sdk-memory`, `-budget`, `-cache`, `-handoff`, `-tools`)
 * are NEVER touched.
 *
 * Usage:
 *   npx @theokit/codemod-sdk-2-0                       # dry-run on cwd
 *   npx @theokit/codemod-sdk-2-0 --write               # apply
 *   npx @theokit/codemod-sdk-2-0 --write --backup      # apply + .bak
 *   npx @theokit/codemod-sdk-2-0 --root path/to/proj   # target other dir
 *
 * Exit code:
 *   0 — clean run; report printed
 *   1 — invocation error or filesystem error
 *
 * For SDK 2.0 cohort consumers. The SDK monorepo uses its own
 * `scripts/phase6-rename-write.mjs` (iter 83); this package is the
 * publishable equivalent downstream consumers run.
 */

import { constants as fsConstants } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const args = process.argv.slice(2);
const WRITE_MODE = args.includes("--write");
const BACKUP = args.includes("--backup");
const ROOT_IDX = args.indexOf("--root");
const ROOT = resolve(ROOT_IDX >= 0 && args[ROOT_IDX + 1] !== undefined ? args[ROOT_IDX + 1] : ".");

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".vitest-cache",
  ".pnpm-store",
  "coverage",
]);

const SDK_SPEC_RE = /@theokit\/sdk(?!-)/g;

const summary = {
  package_json: [],
  source: [],
  documentation: [],
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: codemod walk function inherently complex
async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "EACCES" || err.code === "ENOENT") return;
    throw err;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full);
    } else if (entry.isFile()) {
      await process_file(full);
    }
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: codemod process_file inherently complex
async function process_file(path) {
  const rel = relative(ROOT, path);
  const basename = rel.split("/").pop() ?? "";
  const dot = basename.lastIndexOf(".");
  const ext = dot >= 0 ? basename.slice(dot) : "";

  const TEXT_EXT = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".json", ".md"]);
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
    if (parsed.name === "@theokit/sdk") {
      parsed.name = "@theokit/sdk-core";
      changes.push("name renamed");
    }
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
        deps["@theokit/sdk-core"] = value;
        changes.push(`${block} key renamed`);
      }
    }
    if (parsed.peerDependenciesMeta?.["@theokit/sdk"]) {
      const v = parsed.peerDependenciesMeta["@theokit/sdk"];
      delete parsed.peerDependenciesMeta["@theokit/sdk"];
      parsed.peerDependenciesMeta["@theokit/sdk-core"] = v;
      changes.push("peerDependenciesMeta key renamed");
    }
    if (changes.length > 0) {
      summary.package_json.push({ path: rel, changes });
      if (WRITE_MODE) {
        if (BACKUP) await writeBackup(path, content);
        await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`);
      }
    }
    return;
  }

  if (SDK_SPEC_RE.test(content)) {
    SDK_SPEC_RE.lastIndex = 0;
    const next = content.replace(SDK_SPEC_RE, "@theokit/sdk-core");
    const hits = (content.match(SDK_SPEC_RE) ?? []).length;
    SDK_SPEC_RE.lastIndex = 0;
    const bucket = ext === ".md" ? summary.documentation : summary.source;
    bucket.push({ path: rel, count: hits });
    if (WRITE_MODE) {
      if (BACKUP) await writeBackup(path, content);
      await writeFile(path, next);
    }
  }
}

function printReport() {
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: report section builder
  const section = (label, items) => {
    console.log(`\n## ${label} (${items.length} files)`);
    if (items.length === 0) {
      console.log("(none)");
      return;
    }
    const CAP = 50;
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

  console.log("# @theokit/codemod-sdk-2-0");
  console.log(`Root: ${ROOT}`);
  console.log(`Mode: ${WRITE_MODE ? "WRITE" : "DRY-RUN"}${BACKUP ? " (with .bak)" : ""}`);
  console.log("Replacement: `@theokit/sdk` → `@theokit/sdk-core`");
  console.log("(does NOT touch `@theokit/sdk-memory`, `-budget`, etc.)");

  section("package.json modifications", summary.package_json);
  section("source file modifications", summary.source);
  section("documentation modifications", summary.documentation);

  const total = summary.package_json.length + summary.source.length + summary.documentation.length;
  console.log(`\n## Summary: ${total} files ${WRITE_MODE ? "modified" : "would be modified"}.`);
  if (!WRITE_MODE && total > 0) {
    console.log("\nThis was a dry-run. Re-run with `--write` to apply.");
    console.log("Recommended: `--write --backup` to preserve .bak copies.");
  }
}

async function main() {
  await walk(ROOT);
  printReport();
}

main().catch((err) => {
  console.error("codemod failed:", err);
  process.exit(1);
});

/**
 * Writes `<path>.bak` without following a symlink planted there.
 *
 * `copyFile` follows symlinks, and `<path>.bak` is a name anyone who can write into the tree can
 * predict from a file they can see. This codemod runs on a CONSUMER's repository, so "someone
 * placed a file in the tree" is the ordinary situation rather than a privileged one — the same
 * defect, and the same fix, as `@theokit/sdk-tools`' `edit_file` (CodeQL js/file-system-race,
 * fixed in 434b25fc).
 *
 * O_NOFOLLOW makes the kernel refuse a symlink outright, so nothing can go stale between deciding
 * a path is safe and writing to it. An existing REGULAR `.bak` is still overwritten.
 */
async function writeBackup(path, content) {
  try {
    await writeFile(`${path}.bak`, content, {
      encoding: "utf8",
      flag:
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | fsConstants.O_NOFOLLOW,
    });
  } catch (err) {
    if (err?.code === "ELOOP" || err?.code === "EEXIST") {
      throw new Error(
        `refusing to write ${path}.bak: that path already exists as a symlink. ` +
          "Remove it and re-run, or pass --no-backup.",
      );
    }
    throw err;
  }
}
