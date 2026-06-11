/**
 * Smoke test for scripts/sdk-2-0-stage3-drift-detector.mjs.
 *
 * Verifies:
 *   - Exit code 0 on the current workspace (no unexpected drift).
 *   - Stdout includes canonical header.
 *   - Pairs checked == 38 (full Stage 3 source-move inventory).
 *   - Known divergences allowlist is non-empty (the workarounds
 *     iter 48/53/55/66/67/69/72/74/75 are intentional).
 *
 * Iter 93.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "..", "sdk-2-0-stage3-drift-detector.mjs");

const result = spawnSync("node", [SCRIPT], {
  encoding: "utf8",
  timeout: 15000,
});

const failures = [];

if (result.status !== 0) {
  failures.push(`exit code: expected 0, got ${result.status}`);
}

const stdout = result.stdout ?? "";

if (!stdout.includes("# SDK 2.0 Stage 3 drift detector")) {
  failures.push("missing canonical header");
}

const pairsMatch = stdout.match(/Pairs checked: (\d+)/);
const pairsCount = pairsMatch === null ? -1 : Number(pairsMatch[1]);
if (pairsCount !== 38) {
  failures.push(`Pairs checked: expected 38, got ${pairsCount}`);
}

const divMatch = stdout.match(/Known divergences \(allowlisted\): (\d+)/);
const divCount = divMatch === null ? -1 : Number(divMatch[1]);
if (divCount < 10) {
  failures.push(
    `Known divergences: expected >= 10 (rollup-dts workarounds + others), got ${divCount}`,
  );
}

if (!stdout.includes("## Result: PASS")) {
  failures.push(
    "result: expected 'PASS' on current workspace (any drift = unsynced patch)",
  );
}

if (failures.length > 0) {
  console.error("stage3-drift-detector smoke test FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  console.error("\nstdout:");
  console.error(stdout);
  process.exit(1);
}

console.log(
  `stage3-drift-detector smoke test PASSED (${pairsCount} pairs, ${divCount} allowlisted, 0 unexpected drift).`,
);
