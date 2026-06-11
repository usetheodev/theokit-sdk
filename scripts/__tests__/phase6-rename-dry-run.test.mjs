/**
 * Smoke test for scripts/phase6-rename-dry-run.mjs.
 *
 * Runs the dry-run end-to-end against the actual workspace and
 * verifies:
 *   - Exit code 0 (clean run)
 *   - Stdout includes the canonical header
 *   - Stdout reports a non-zero total (workspace has @theokit/sdk
 *     references — sdk-core itself, examples, internal tests)
 *   - Stdout does NOT contain `@theokit/sdk-memory` as a rename target
 *     (negative lookahead invariant holds)
 *
 * Run with: node scripts/__tests__/phase6-rename-dry-run.test.mjs
 *
 * Iter 81 (Phase 6 prep): smoke test for the dry-run tool itself.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "..", "phase6-rename-dry-run.mjs");

const result = spawnSync("node", [SCRIPT], {
  encoding: "utf8",
  // 30s should be more than enough for the workspace walk.
  timeout: 30000,
});

const failures = [];

if (result.status !== 0) {
  failures.push(`exit code: expected 0, got ${result.status}`);
}

const stdout = result.stdout ?? "";

if (!stdout.includes("# Phase 6 rename dry-run report")) {
  failures.push("stdout missing canonical header line");
}

if (!stdout.includes("`@theokit/sdk` → `@theokit/sdk-core`")) {
  failures.push("stdout missing rename direction announcement");
}

if (!stdout.includes("## Summary:")) {
  failures.push("stdout missing summary line");
}

// Verify the negative-lookahead invariant: `@theokit/sdk-memory` (and
// the other sub-packages) MUST NOT appear as rename targets. The
// dry-run header explicitly says so; if the source-import section
// were ever expanded to include them, this assertion fires.
const lookaheadInvariantViolated =
  / - .*@theokit\/sdk-memory/.test(stdout) ||
  / - .*@theokit\/sdk-budget/.test(stdout) ||
  / - .*@theokit\/sdk-cache/.test(stdout) ||
  / - .*@theokit\/sdk-handoff/.test(stdout) ||
  / - .*@theokit\/sdk-tools/.test(stdout);
if (lookaheadInvariantViolated) {
  failures.push(
    "negative-lookahead invariant violated — `@theokit/sdk-{memory,budget,...}` listed as rename target",
  );
}

// Sanity: the workspace HAS @theokit/sdk references (sdk-core itself
// is the package being renamed), so a 0-file report would indicate
// the walker failed silently.
const summaryMatch = stdout.match(/## Summary: (\d+) files would be touched\./);
const totalFiles = summaryMatch === null ? -1 : Number(summaryMatch[1]);
if (totalFiles <= 0) {
  failures.push(
    `summary total file count: expected > 0, got ${totalFiles} (walker may have failed)`,
  );
}

if (failures.length > 0) {
  console.error("phase6-rename-dry-run smoke test FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  console.error("\nstdout was:");
  console.error(stdout.slice(0, 2000));
  process.exit(1);
}

console.log(
  `phase6-rename-dry-run smoke test PASSED (${totalFiles} files reported).`,
);
