/**
 * Smoke test for scripts/sdk-2-0-post-publish-check.mjs.
 *
 * Runs in --dry mode (no network calls) and verifies:
 *   - Exit code 0 on dry mode.
 *   - Header contains "DRY (no npm view calls)".
 *   - Cohort table has 7 entries (sdk + sdk-core + 5 sub-packages).
 *   - Pre-Phase-6 workspace correctly marks @theokit/sdk-core as
 *     "not in workspace, skipped" + @theokit/sdk as eligible.
 *   - `--only` flag narrows the cohort.
 *
 * Iter 90.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "..", "sdk-2-0-post-publish-check.mjs");

const failures = [];

// Test 1: --dry default cohort.
const run1 = spawnSync("node", [SCRIPT, "--dry"], {
  encoding: "utf8",
  timeout: 30000,
});

if (run1.status !== 0) failures.push(`--dry exit: ${run1.status}`);
const out1 = run1.stdout ?? "";
if (!out1.includes("Mode: DRY (no npm view calls)")) {
  failures.push("--dry header missing");
}
if (!out1.includes("## Cohort check (7 packages)")) {
  failures.push("--dry default cohort should have 7 packages");
}
// Pre-Phase-6 expectation: sdk-core IS skipped, sdk IS present.
if (!out1.includes("@theokit/sdk-core             (not in workspace, skipped)")) {
  failures.push("--dry should mark sdk-core as not-in-workspace pre-Phase-6");
}
if (!/@theokit\/sdk\s+workspace=1\./.test(out1)) {
  failures.push("--dry should show @theokit/sdk workspace=1.x in pre-Phase-6 state");
}

// Test 2: --only narrows cohort.
const run2 = spawnSync(
  "node",
  [
    SCRIPT,
    "--dry",
    "--only",
    "@theokit/sdk,@theokit/sdk-memory",
  ],
  { encoding: "utf8", timeout: 30000 },
);
if (run2.status !== 0) failures.push(`--only exit: ${run2.status}`);
const out2 = run2.stdout ?? "";
if (!out2.includes("## Cohort check (2 packages)")) {
  failures.push("--only flag should narrow cohort to 2 packages");
}
if (out2.includes("@theokit/sdk-budget")) {
  failures.push("--only flag did not exclude @theokit/sdk-budget");
}

if (failures.length > 0) {
  console.error("sdk-2-0-post-publish-check smoke test FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  console.error("\n--dry stdout:");
  console.error(out1);
  process.exit(1);
}

console.log(
  "sdk-2-0-post-publish-check smoke test PASSED (--dry default + --only flag verified).",
);
