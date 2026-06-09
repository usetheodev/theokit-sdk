/**
 * Smoke test for scripts/phase6-rename-write.mjs.
 *
 * Verifies:
 *   - Default mode (no --write flag) is dry-run; runs cleanly + reports.
 *   - Dry-run output is deterministic — running twice produces identical
 *     reports + the working tree is unmodified.
 *   - The write-tool report header explicitly says "DRY-RUN" when no
 *     --write flag was passed.
 *   - The same negative-lookahead invariant holds (sub-packages
 *     untouched).
 *
 * The actual --write mode is not exercised in CI because it would
 * mutate the workspace tree. Operators run --write manually after
 * dry-run inspection.
 *
 * Iter 83 (Phase 6 prep #2): smoke test for the write tool's
 * dry-run path.
 */

import { spawnSync } from "node:child_process";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "..", "phase6-rename-write.mjs");
const REPO_ROOT = join(__dirname, "..", "..");

const failures = [];

// Capture git status BEFORE running the script.
const gitStatusBefore = execSync("git status --porcelain", {
  cwd: REPO_ROOT,
  encoding: "utf8",
});

// Run dry-run twice and verify identical output (modulo timestamps).
const run1 = spawnSync("node", [SCRIPT], { encoding: "utf8", timeout: 30000 });
const run2 = spawnSync("node", [SCRIPT], { encoding: "utf8", timeout: 30000 });

if (run1.status !== 0) {
  failures.push(`dry-run #1 exit: expected 0, got ${run1.status}`);
}
if (run2.status !== 0) {
  failures.push(`dry-run #2 exit: expected 0, got ${run2.status}`);
}

const out1 = run1.stdout ?? "";
const out2 = run2.stdout ?? "";

if (out1 !== out2) {
  failures.push(
    "dry-run output non-deterministic — two runs produced different reports",
  );
}

if (!out1.includes("Mode: DRY-RUN")) {
  failures.push("dry-run header missing 'Mode: DRY-RUN'");
}

if (!out1.includes("Re-run with `--write` to apply")) {
  failures.push("dry-run footer missing --write hint");
}

// Negative-lookahead invariant — sub-packages NOT touched.
const subpackageLeakRe =
  / - .*@theokit\/sdk-(memory|budget|cache|handoff|tools)/;
if (subpackageLeakRe.test(out1)) {
  failures.push("negative-lookahead invariant violated in dry-run output");
}

// Sanity: workspace HAS @theokit/sdk references, so a 0-file report
// would indicate the walker silently failed.
const summaryMatch = out1.match(/## Summary: (\d+) files would be modified\./);
const total = summaryMatch === null ? -1 : Number(summaryMatch[1]);
if (total <= 0) {
  failures.push(
    `summary total: expected > 0, got ${total} (walker may have failed)`,
  );
}

// Capture git status AFTER — must be IDENTICAL to before (dry-run is
// non-destructive).
const gitStatusAfter = execSync("git status --porcelain", {
  cwd: REPO_ROOT,
  encoding: "utf8",
});

if (gitStatusBefore !== gitStatusAfter) {
  failures.push(
    "working tree changed during dry-run — dry-run is supposed to be non-destructive",
  );
}

if (failures.length > 0) {
  console.error("phase6-rename-write smoke test FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  if (out1.length > 0) {
    console.error("\nfirst-run stdout (truncated):");
    console.error(out1.slice(0, 1500));
  }
  process.exit(1);
}

console.log(
  `phase6-rename-write smoke test PASSED (${total} files reported; working tree unchanged).`,
);
