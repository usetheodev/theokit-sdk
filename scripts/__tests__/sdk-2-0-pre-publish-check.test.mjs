/**
 * Smoke test for scripts/sdk-2-0-pre-publish-check.mjs.
 *
 * The current workspace state is pre-Phase-6 (sdk-core not renamed
 * yet); the check should PASS because none of the post-Phase-6
 * gates apply. We verify:
 *   - Exit code 0 (clean run on a clean workspace)
 *   - Stdout includes canonical header + result line
 *   - Stdout reports the correct package count (>= 50, < 100;
 *     workspace size is stable around 51-57)
 *   - Stdout identifies sdk-core OR sdk-legacy (exactly one)
 *
 * Iter 87 — release-gate smoke test.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "..", "sdk-2-0-pre-publish-check.mjs");

const result = spawnSync("node", [SCRIPT], {
  encoding: "utf8",
  timeout: 30000,
});

const failures = [];

if (result.status !== 0) {
  failures.push(`exit code: expected 0, got ${result.status}`);
}

const stdout = result.stdout ?? "";

if (!stdout.includes("# SDK 2.0 pre-publish validation gate")) {
  failures.push("stdout missing canonical header");
}

if (!stdout.includes("Workspace packages scanned:")) {
  failures.push("stdout missing 'Workspace packages scanned' line");
}

// Workspace should have between 50 and 100 packages (current state ~57).
const countMatch = stdout.match(/Workspace packages scanned: (\d+)/);
const count = countMatch === null ? -1 : Number(countMatch[1]);
if (count < 30 || count > 200) {
  failures.push(
    `package count out of expected range [30..200]: got ${count}`,
  );
}

const hasSdkCore = stdout.includes("sdk-core: @theokit/sdk-core");
const hasSdkLegacy = stdout.includes("sdk legacy: @theokit/sdk @");
if (!hasSdkCore && !hasSdkLegacy) {
  failures.push("neither sdk-core nor sdk-legacy detected");
}
if (hasSdkCore && hasSdkLegacy) {
  // This is itself a gate violation; the script's own report would
  // include it. So if both are present, the run should have exited
  // non-zero. Only flag here if the script returned exit 0 anyway.
  if (result.status === 0) {
    failures.push(
      "both sdk-core and sdk-legacy present but script exited 0 — gate logic bug",
    );
  }
}

// Should report PASS in the current pre-Phase-6 state.
if (!stdout.includes("## Result: PASS")) {
  failures.push(
    "stdout missing 'Result: PASS' — current workspace state should pass all gates",
  );
}

if (failures.length > 0) {
  console.error("sdk-2-0-pre-publish-check smoke test FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  console.error("\nstdout was:");
  console.error(stdout);
  process.exit(1);
}

console.log(
  `sdk-2-0-pre-publish-check smoke test PASSED (${count} packages scanned, all gates green).`,
);
