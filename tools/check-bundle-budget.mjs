#!/usr/bin/env node
/**
 * Bundle budget gate — SDK 2.0 split (Phase 10 / T10.1; ADR D9).
 *
 * Reads every `packages/<name>/.bundle-budget.json` file, measures the
 * gzipped size of declared dist artifacts, and fails CI when any package
 * exceeds its budget. Without this, the SDK 2.0 split's bundle gains
 * silently regress: someone adds a re-export, the barrel grows, no one
 * notices until the next release.
 *
 * Usage:
 *   node tools/check-bundle-budget.mjs                # check all packages
 *   node tools/check-bundle-budget.mjs --json         # JSON output (CI machine-readable)
 *   node tools/check-bundle-budget.mjs --package=X    # check single package
 *
 * Exit codes:
 *   0 — all packages within budget
 *   1 — at least one package over budget (FAIL)
 *   2 — invocation error (missing dist, malformed config, etc.)
 *
 * Budget file format (`packages/<name>/.bundle-budget.json`):
 *   {
 *     "dist/index.js": 25000,        // bytes gzipped, max
 *     "dist/some-other.js": 10000
 *   }
 *
 * Edge cases:
 * - Missing dist file → WARN, exit 0 (build was skipped; not a budget violation
 *   per spec — avoids false positives on WIP branches).
 * - Malformed budget config → exit 2 with file:line.
 * - Zero or negative budget value → exit 2 (programmer error).
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");

const args = process.argv.slice(2);
const wantJson = args.includes("--json");
const packageFilter = args.find((a) => a.startsWith("--package="))?.slice("--package=".length);

/**
 * @typedef {{name: string, budgetFile: string, dist: string, max: number, actual: number | null, status: "PASS" | "FAIL" | "WARN_MISSING_DIST"}} Result
 */

/** @returns {Result[]} */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one cohesive pass that walks every package, reads its budget file and classifies the result (PASS / FAIL / WARN_MISSING_DIST). Splitting it would scatter the budget rules across helpers that only ever run in this order. Surfaced when the file moved from the unlinted `scripts/` into `tools/`; pre-existing shape, not new debt.
function collectResults() {
  /** @type {Result[]} */
  const results = [];
  const packageDirs = readdirSync(PACKAGES_DIR).filter((entry) => {
    const full = join(PACKAGES_DIR, entry);
    return statSync(full).isDirectory();
  });

  for (const pkgName of packageDirs) {
    if (packageFilter !== undefined && pkgName !== packageFilter) continue;
    const budgetFile = join(PACKAGES_DIR, pkgName, ".bundle-budget.json");
    if (!existsSync(budgetFile)) continue;

    let config;
    try {
      config = JSON.parse(readFileSync(budgetFile, "utf-8"));
    } catch (err) {
      console.error(`[bundle-budget] FATAL: malformed ${budgetFile}: ${err.message}`);
      process.exit(2);
    }
    if (typeof config !== "object" || config === null || Array.isArray(config)) {
      console.error(`[bundle-budget] FATAL: ${budgetFile} must be an object`);
      process.exit(2);
    }

    for (const [distRel, maxRaw] of Object.entries(config)) {
      if (typeof maxRaw !== "number" || maxRaw <= 0 || !Number.isFinite(maxRaw)) {
        console.error(
          `[bundle-budget] FATAL: ${budgetFile} key "${distRel}" must be positive integer (got ${JSON.stringify(maxRaw)})`,
        );
        process.exit(2);
      }
      const max = Math.floor(maxRaw);
      const distFile = join(PACKAGES_DIR, pkgName, distRel);
      if (!existsSync(distFile)) {
        results.push({
          name: pkgName,
          budgetFile,
          dist: distRel,
          max,
          actual: null,
          status: "WARN_MISSING_DIST",
        });
        continue;
      }
      const raw = readFileSync(distFile);
      const gz = gzipSync(raw).length;
      results.push({
        name: pkgName,
        budgetFile,
        dist: distRel,
        max,
        actual: gz,
        status: gz <= max ? "PASS" : "FAIL",
      });
    }
  }
  return results;
}

const results = collectResults();

if (wantJson) {
  console.log(JSON.stringify(results, null, 2));
  process.exit(results.some((r) => r.status === "FAIL") ? 1 : 0);
}

// Human-readable table
let anyFail = false;
for (const r of results) {
  if (r.status === "FAIL") anyFail = true;
  const actualStr = r.actual === null ? "MISSING" : String(r.actual).padStart(7);
  const maxStr = String(r.max).padStart(7);
  const pct = r.actual === null ? "—" : `${Math.round((r.actual / r.max) * 100)}%`.padStart(4);
  const marker = r.status === "FAIL" ? "❌" : r.status === "WARN_MISSING_DIST" ? "⚠" : "✓";
  console.log(
    `[bundle-budget] ${marker} ${r.status.padEnd(18)} ${r.name.padEnd(20)} ${r.dist.padEnd(20)} ${actualStr} / ${maxStr} bytes  (${pct})`,
  );
}

if (results.length === 0) {
  console.log("[bundle-budget] No packages with .bundle-budget.json found.");
  process.exit(0);
}

if (anyFail) {
  console.error("\n[bundle-budget] FAIL — at least one package exceeded its budget.");
  console.error(
    "[bundle-budget] Either reduce the bundle size or bump the budget with justification in the PR description.",
  );
  process.exit(1);
}

const missing = results.filter((r) => r.status === "WARN_MISSING_DIST").length;
if (missing > 0) {
  console.warn(
    `\n[bundle-budget] ${missing} dist file(s) missing — did you forget to run 'pnpm -r build'?`,
  );
}
console.log(`\n[bundle-budget] PASS — ${results.length} budget entries checked.`);
process.exit(0);
