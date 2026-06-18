#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

// EC-1: Node version guard (matches SDK engines.node)
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error(`@theokit/sdk requires Node >= 22.12.0. Current: ${process.version}`);
  process.exit(1);
}

const templateDir = join(import.meta.dirname, "../claude-template");
const cwd = process.cwd();
const targetDir = join(cwd, ".claude");
const force = process.argv.includes("--force");

/**
 * Merge-copy: recursively copies src into dest, skipping files that already
 * exist in dest. With --force, overwrites everything.
 * Returns { added, skipped } counts.
 */
function mergeCopy(src, dest) {
  let added = 0;
  let skipped = 0;
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      const sub = mergeCopy(srcPath, destPath);
      added += sub.added;
      skipped += sub.skipped;
    } else if (force || !existsSync(destPath)) {
      cpSync(srcPath, destPath);
      added++;
    } else {
      skipped++;
    }
  }
  return { added, skipped };
}

// Merge .claude/ directory (skills, rules, settings)
const dotClaude = mergeCopy(join(templateDir, "dot-claude"), targetDir);

// Merge root files (AGENTS.md, CLAUDE.md)
let rootAdded = 0;
let rootSkipped = 0;
for (const file of ["AGENTS.md", "CLAUDE.md"]) {
  const dest = join(cwd, file);
  if (force || !existsSync(dest)) {
    cpSync(join(templateDir, file), dest);
    rootAdded++;
  } else {
    rootSkipped++;
  }
}

const totalAdded = dotClaude.added + rootAdded;
const totalSkipped = dotClaude.skipped + rootSkipped;

if (totalAdded === 0) {
  console.log("All TheoKit SDK files already present. Nothing to add.");
  console.log("Use --force to overwrite existing files.");
} else {
  console.log(`Added ${totalAdded} file(s). Skipped ${totalSkipped} existing file(s).`);
  console.log("\nNext: open Claude Code and start building with TheoKit.");
}
