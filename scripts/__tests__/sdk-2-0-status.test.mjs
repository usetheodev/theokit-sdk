/**
 * Smoke test for scripts/sdk-2-0-status.mjs.
 *
 * Verifies the aggregator produces a coherent one-page report:
 *   - Markdown mode emits canonical sections (Read-only gates / Long-running
 *     gates / Operator action required / Verdict).
 *   - JSON mode emits a parseable object with required fields.
 *   - Every read-only gate produces a `pass: true` row on the current
 *     workspace.
 *   - Exit code 0 when all read-only gates pass.
 *
 * Iter 105.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "..", "sdk-2-0-status.mjs");

const failures = [];

function pushFail(condition, message) {
  if (condition) failures.push(message);
}

// 1) Markdown mode.
const md = spawnSync("node", [SCRIPT], {
  encoding: "utf8",
  timeout: 30000,
});

pushFail(md.status !== 0, `markdown mode exit: expected 0, got ${md.status}`);

const stdout = md.stdout ?? "";

for (const section of [
  "# SDK 2.0 release-readiness status",
  "## Read-only gates (deterministic)",
  "## Long-running gates (NOT run by default)",
  "## Operator action required",
  "## Verdict:",
]) {
  pushFail(!stdout.includes(section), `markdown missing section "${section}"`);
}

// All 4 gates should show a ✓ checkmark on the current workspace.
const checkmarkCount = (stdout.match(/✓ /g) ?? []).length;
pushFail(
  checkmarkCount < 4,
  `expected ≥4 ✓ markers (one per read-only gate), got ${checkmarkCount}`,
);

// Verdict line must be the GREEN variant.
pushFail(
  !stdout.includes("Verdict: READ-ONLY GATES GREEN"),
  "verdict line not the GREEN variant on current workspace",
);

// 2) JSON mode.
const j = spawnSync("node", [SCRIPT, "--json"], {
  encoding: "utf8",
  timeout: 30000,
});

pushFail(j.status !== 0, `json mode exit: expected 0, got ${j.status}`);

let parsed;
try {
  parsed = JSON.parse(j.stdout ?? "");
} catch (err) {
  failures.push(`json mode stdout not parseable: ${err.message}`);
}

if (parsed !== undefined) {
  pushFail(parsed.all_read_only_pass !== true, "json: all_read_only_pass !== true");
  pushFail(!Array.isArray(parsed.gates), "json: gates not an array");
  pushFail(parsed.gates.length !== 4, `json: expected 4 gates, got ${parsed.gates.length}`);
  for (const g of parsed.gates ?? []) {
    pushFail(g.pass !== true, `json: gate "${g.label}" pass !== true`);
  }
  pushFail(typeof parsed.timestamp !== "string", "json: missing timestamp");
  pushFail(!Array.isArray(parsed.long_running), "json: long_running not an array");
  pushFail(!Array.isArray(parsed.operator_steps), "json: operator_steps not an array");
}

if (failures.length > 0) {
  console.error("sdk-2-0-status smoke test FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  console.error("\nmarkdown stdout (first 30 lines):");
  console.error(stdout.split("\n").slice(0, 30).map((l) => `  ${l}`).join("\n"));
  process.exit(1);
}

console.log("sdk-2-0-status smoke test PASSED (markdown + json modes).");
