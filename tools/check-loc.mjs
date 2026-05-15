#!/usr/bin/env node
// File LoC budget checker — enforces Quality Gate G8.
//
// Walks packages/sdk/src/**/*.ts (excluding tests) and counts logical lines
// of code: non-empty, non-pure-comment lines. Block comments (/* ... */) are
// skipped entirely; line comments (//) and JSDoc lines (*) are skipped.
//
// Threshold: defined in .claude/quality-gates.md G8. Currently 400.

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const LOC_LIMIT = 400;
const SCAN_ROOTS = ["packages/sdk/src"];
const EXCLUDE_BASENAMES = new Set(["node_modules", "dist", "coverage", ".git"]);
const EXCLUDE_FILE_PATTERNS = [/\.test\.ts$/, /\.test-d\.ts$/, /\.spec\.ts$/, /\.d\.ts$/];

function shouldIncludeFile(entry) {
  if (!entry.isFile()) return false;
  if (!/\.ts$/.test(entry.name)) return false;
  return !EXCLUDE_FILE_PATTERNS.some((pattern) => pattern.test(entry.name));
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (EXCLUDE_BASENAMES.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(path)));
      continue;
    }
    if (shouldIncludeFile(entry)) files.push(path);
  }
  return files;
}

/**
 * Per-line classification for LoC counting.
 * Returns { isCode, blockCommentDelta } where blockCommentDelta is:
 *  +1 → enter block comment, -1 → exit block comment, 0 → no change.
 */
function classifyLine(line, inBlockComment) {
  if (line.length === 0) return { isCode: false, blockCommentDelta: 0 };
  if (inBlockComment) {
    return { isCode: false, blockCommentDelta: line.includes("*/") ? -1 : 0 };
  }
  if (line.startsWith("/*")) {
    return { isCode: false, blockCommentDelta: line.includes("*/") ? 0 : 1 };
  }
  if (line.startsWith("//")) return { isCode: false, blockCommentDelta: 0 };
  if (line.startsWith("*") || line === "*/") return { isCode: false, blockCommentDelta: 0 };
  return { isCode: true, blockCommentDelta: 0 };
}

function countLogicalLoc(text) {
  let count = 0;
  let inBlockComment = false;
  for (const rawLine of text.split("\n")) {
    const { isCode, blockCommentDelta } = classifyLine(rawLine.trim(), inBlockComment);
    if (blockCommentDelta === 1) inBlockComment = true;
    else if (blockCommentDelta === -1) inBlockComment = false;
    if (isCode) count++;
  }
  return count;
}

async function main() {
  const violations = [];
  let scanned = 0;

  for (const scanRoot of SCAN_ROOTS) {
    const absoluteRoot = resolve(ROOT, scanRoot);
    const files = await walk(absoluteRoot);
    for (const file of files) {
      scanned++;
      const text = await readFile(file, "utf8");
      const loc = countLogicalLoc(text);
      if (loc > LOC_LIMIT) {
        violations.push({ file: relative(ROOT, file), loc });
      }
    }
  }

  if (violations.length > 0) {
    console.error(`✗ G8 violated: ${violations.length} file(s) exceed ${LOC_LIMIT} LoC`);
    for (const { file, loc } of violations.sort((a, b) => b.loc - a.loc)) {
      console.error(`  ${file}: ${loc} LoC (over by ${loc - LOC_LIMIT})`);
    }
    console.error("");
    console.error("Fix: split the file into focused modules. See .claude/quality-gates.md G8.");
    process.exit(1);
  }

  console.log(`✓ G8 passed: ${scanned} file(s) scanned, all ≤ ${LOC_LIMIT} LoC`);
}

main().catch((error) => {
  console.error("check-loc.mjs crashed:", error);
  process.exit(2);
});
