/**
 * Smoke test for scripts/phase7-peerdep-bump.mjs.
 *
 * Verifies:
 *   - Dry-run mode exit 0, working tree unchanged.
 *   - Dry-run output is deterministic across two runs.
 *   - Default target is `^2.0.0`.
 *   - `--target` flag overrides the default.
 *   - Workspace links + file: specs are SKIPPED (not bumped).
 *
 * Iter 85 (Phase 7 prep #2).
 */

import { spawnSync } from "node:child_process";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "..", "phase7-peerdep-bump.mjs");
const REPO_ROOT = join(__dirname, "..", "..");

const failures = [];

// Capture git status BEFORE.
const gitStatusBefore = execSync("git status --porcelain", {
  cwd: REPO_ROOT,
  encoding: "utf8",
});

// Run dry-run twice.
const run1 = spawnSync("node", [SCRIPT], { encoding: "utf8", timeout: 30000 });
const run2 = spawnSync("node", [SCRIPT], { encoding: "utf8", timeout: 30000 });

if (run1.status !== 0) failures.push(`run1 exit: ${run1.status}`);
if (run2.status !== 0) failures.push(`run2 exit: ${run2.status}`);

const out1 = run1.stdout ?? "";
const out2 = run2.stdout ?? "";

if (out1 !== out2) {
  failures.push("dry-run output non-deterministic");
}

if (!out1.includes("Mode: DRY-RUN")) {
  failures.push("missing 'Mode: DRY-RUN'");
}

if (!out1.includes("Target version constraint: ^2.0.0")) {
  failures.push("default target is not ^2.0.0");
}

// Test --target flag override.
const runCustom = spawnSync("node", [SCRIPT, "--target", ">=2.0.0"], {
  encoding: "utf8",
  timeout: 30000,
});
if (runCustom.status !== 0) {
  failures.push(`--target run exit: ${runCustom.status}`);
}
const customOut = runCustom.stdout ?? "";
if (!customOut.includes("Target version constraint: >=2.0.0")) {
  failures.push("--target flag did not override target");
}

// Workspace + file specs must NOT appear in the affected-packages list.
// The dry-run lists every "from" → "to" change. workspace:/file: specs
// are skipped per design.
const fromSpecRe = /-\s+peerDependencies\.@theokit\/sdk[^:]*:\s+"([^"]+)"/g;
let leak = false;
let match;
while ((match = fromSpecRe.exec(out1)) !== null) {
  const from = match[1];
  if (from.startsWith("workspace:") || from.startsWith("file:")) {
    leak = true;
    break;
  }
}
if (leak) {
  failures.push("workspace:/file: spec leaked into bump list");
}

// Working tree unchanged after dry-run.
const gitStatusAfter = execSync("git status --porcelain", {
  cwd: REPO_ROOT,
  encoding: "utf8",
});
if (gitStatusBefore !== gitStatusAfter) {
  failures.push("working tree changed during dry-run");
}

if (failures.length > 0) {
  console.error("phase7-peerdep-bump smoke test FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  if (out1.length > 0) {
    console.error("\ndry-run stdout (truncated):");
    console.error(out1.slice(0, 1500));
  }
  process.exit(1);
}

const summaryMatch = out1.match(/## Summary: (\d+) packages would be modified\./);
const totalPkgs = summaryMatch === null ? -1 : Number(summaryMatch[1]);
console.log(
  `phase7-peerdep-bump smoke test PASSED (${totalPkgs} packages reported; working tree unchanged).`,
);
