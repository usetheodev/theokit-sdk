/**
 * Smoke test for scripts/phase7-cohort-analysis.mjs.
 *
 * Verifies:
 *   - Exit code 0 (clean run)
 *   - Stdout is valid JSON
 *   - Cohort length > 0 (workspace has sdk consumers)
 *   - Stderr contains the canonical summary header + histogram
 *   - JSON entries have the required shape (package, version,
 *     path, isWorkspace, refs)
 *
 * Iter 84 (Phase 7 prep): smoke test for the cohort-analysis tool.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "..", "phase7-cohort-analysis.mjs");

const result = spawnSync("node", [SCRIPT], {
  encoding: "utf8",
  timeout: 30000,
});

const failures = [];

if (result.status !== 0) {
  failures.push(`exit code: expected 0, got ${result.status}`);
}

const stdout = result.stdout ?? "";
const stderr = result.stderr ?? "";

// Parse JSON output.
let cohort;
try {
  cohort = JSON.parse(stdout);
} catch (err) {
  failures.push(`stdout is not valid JSON: ${(err && err.message) || err}`);
}

if (Array.isArray(cohort)) {
  if (cohort.length === 0) {
    failures.push("cohort empty — workspace should have sdk consumers");
  }
  // Verify shape of first 5 entries.
  for (const entry of cohort.slice(0, 5)) {
    if (typeof entry.package !== "string") {
      failures.push("entry.package: expected string");
    }
    if (typeof entry.version !== "string") {
      failures.push("entry.version: expected string");
    }
    if (typeof entry.path !== "string") {
      failures.push("entry.path: expected string");
    }
    if (typeof entry.isWorkspace !== "boolean") {
      failures.push("entry.isWorkspace: expected boolean");
    }
    if (!Array.isArray(entry.refs) || entry.refs.length === 0) {
      failures.push("entry.refs: expected non-empty array");
    } else {
      for (const ref of entry.refs) {
        if (
          typeof ref.block !== "string" ||
          typeof ref.key !== "string" ||
          typeof ref.version !== "string"
        ) {
          failures.push("ref shape malformed");
          break;
        }
      }
    }
  }
} else if (cohort !== undefined) {
  failures.push("cohort: expected array");
}

// Summary should appear on stderr.
if (!stderr.includes("# Phase 7 cohort analysis")) {
  failures.push("stderr missing canonical header");
}
if (!stderr.includes("## Version spec histogram")) {
  failures.push("stderr missing version histogram section");
}
if (!stderr.includes("Consumers found:")) {
  failures.push("stderr missing 'Consumers found' counter");
}

if (failures.length > 0) {
  console.error("phase7-cohort-analysis smoke test FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

const len = Array.isArray(cohort) ? cohort.length : -1;
console.log(`phase7-cohort-analysis smoke test PASSED (${len} consumers reported).`);
