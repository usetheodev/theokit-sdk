#!/usr/bin/env node
/**
 * SDK 2.0 — single-command validation runner.
 *
 * Runs every SDK 2.0 migration gate locally + reports a summary.
 * Maintainers run this before opening a PR that touches the
 * migration tooling so CI gates won't surprise them.
 *
 * Usage:
 *   node scripts/validate-sdk-2-0.mjs               # run all gates
 *   node scripts/validate-sdk-2-0.mjs --bail        # exit on first failure
 *
 * Exit code:
 *   0 — all gates pass
 *   1 — at least one gate failed
 *
 * Iter 98.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

const BAIL = process.argv.includes("--bail");

const GATES = [
  {
    label: "Phase 6 — rename dry-run smoke",
    cmd: ["node", "scripts/__tests__/phase6-rename-dry-run.test.mjs"],
  },
  {
    label: "Phase 6 — rename write tool (dry mode) smoke",
    cmd: ["node", "scripts/__tests__/phase6-rename-write.test.mjs"],
  },
  {
    label: "Phase 7 — cohort analysis smoke",
    cmd: ["node", "scripts/__tests__/phase7-cohort-analysis.test.mjs"],
  },
  {
    label: "Phase 7 — peerDep bump (dry mode) smoke",
    cmd: ["node", "scripts/__tests__/phase7-peerdep-bump.test.mjs"],
  },
  {
    label: "Pre-publish validation gate smoke",
    cmd: ["node", "scripts/__tests__/sdk-2-0-pre-publish-check.test.mjs"],
  },
  {
    label: "Post-publish validation (dry mode) smoke",
    cmd: ["node", "scripts/__tests__/sdk-2-0-post-publish-check.test.mjs"],
  },
  {
    label: "Downstream codemod integration test",
    cmd: ["node", "packages/codemod-sdk-2-0/tests/codemod.test.mjs"],
  },
  {
    label: "codemod ↔ phase6 equivalence test",
    cmd: ["node", "scripts/__tests__/codemod-vs-phase6-equivalence.test.mjs"],
  },
  {
    label: "Stage 3 drift detector smoke",
    cmd: ["node", "scripts/__tests__/sdk-2-0-stage3-drift-detector.test.mjs"],
  },
  {
    label: "Migration pipeline end-to-end test",
    cmd: ["node", "scripts/__tests__/sdk-2-0-pipeline-e2e.test.mjs"],
  },
];

const results = [];

function fmtDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

console.log("# SDK 2.0 validation runner");
console.log(`Repo: ${REPO_ROOT}`);
console.log(`Gates: ${GATES.length}`);
console.log("");

const overallStart = Date.now();

for (const gate of GATES) {
  process.stdout.write(`▶ ${gate.label} ... `);
  const start = Date.now();
  const r = spawnSync(gate.cmd[0], gate.cmd.slice(1), {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 60000,
  });
  const duration = Date.now() - start;
  const pass = r.status === 0;
  console.log(pass ? `✓ (${fmtDuration(duration)})` : `✗ (${fmtDuration(duration)})`);
  results.push({
    label: gate.label,
    pass,
    duration,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    exit: r.status,
  });
  if (!pass && BAIL) break;
}

const totalDuration = Date.now() - overallStart;
const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);

console.log("");
console.log("## Summary");
console.log(`  Passed:  ${passed} / ${results.length}`);
console.log(`  Failed:  ${failed.length}`);
console.log(`  Duration: ${fmtDuration(totalDuration)}`);

if (failed.length > 0) {
  console.log("");
  console.log("## Failure details");
  for (const f of failed) {
    console.log(`\n### ${f.label} (exit ${f.exit})`);
    if (f.stderr.trim().length > 0) {
      console.log("stderr:");
      console.log(f.stderr.split("\n").slice(0, 20).map((l) => `  ${l}`).join("\n"));
    }
    if (f.stdout.trim().length > 0) {
      console.log("stdout (last 20 lines):");
      console.log(
        f.stdout
          .split("\n")
          .filter((l) => l.length > 0)
          .slice(-20)
          .map((l) => `  ${l}`)
          .join("\n"),
      );
    }
  }
  process.exit(1);
}

console.log("");
console.log("All gates green.");
