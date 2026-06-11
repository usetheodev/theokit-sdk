#!/usr/bin/env node
/**
 * SDK 2.0 release-readiness status aggregator.
 *
 * Runs the read-only / deterministic gates and emits a single-page
 * markdown report operators can paste into a release issue / PR / chat.
 * Mirrors the per-gate scripts but trades raw stdout for a structured
 * snapshot suitable for "are we ready to ship?" sign-off.
 *
 * Scope: read-only — never mutates the workspace.
 * The cohort publint+attw gate is NOT invoked because it takes ~5min
 * (use `pnpm run sdk-2-0:cohort:readiness` explicitly).
 *
 * Usage:
 *   node scripts/sdk-2-0-status.mjs           # markdown to stdout
 *   node scripts/sdk-2-0-status.mjs --json    # JSON to stdout
 *
 * Exit code:
 *   0 — every read-only gate passed
 *   1 — at least one read-only gate failed (release-not-ready)
 *
 * Iter 105.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

const JSON_MODE = process.argv.includes("--json");

function runScript(label, scriptPath, extractor) {
  const r = spawnSync("node", [scriptPath], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 30000,
  });
  const stdout = r.stdout ?? "";
  const pass = r.status === 0;
  const metrics = pass ? (extractor(stdout) ?? {}) : { error: r.stderr?.slice(0, 200) ?? "" };
  return { label, pass, metrics };
}

function extractInt(text, regex) {
  const m = text.match(regex);
  return m === null ? null : Number(m[1]);
}

function runBundleBudget() {
  // check-bundle-budget.mjs emits a JSON array (--json) on stdout.
  // status per entry ∈ {PASS, FAIL, WARN_MISSING_DIST}. The script
  // exits 0 when all PASS or only WARNs (dist absent on fresh clone),
  // exit 1 on actual FAIL. Treat WARN_MISSING_DIST as "not measured"
  // — informational, not a release blocker, because dist absence is
  // a legitimate state on PR branches before CI builds.
  const r = spawnSync("node", ["scripts/check-bundle-budget.mjs", "--json"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 30000,
  });
  const stdout = r.stdout ?? "";
  let parsed = null;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return {
      label: "Bundle budgets",
      pass: false,
      metrics: { error: "could not parse check-bundle-budget --json output" },
    };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { label: "Bundle budgets", pass: true, metrics: { measured: 0 } };
  }
  const fails = parsed.filter((p) => p.status === "FAIL");
  const warns = parsed.filter((p) => p.status === "WARN_MISSING_DIST");
  const passes = parsed.filter((p) => p.status === "PASS");
  return {
    label: "Bundle budgets",
    pass: fails.length === 0,
    metrics: {
      pass_count: passes.length,
      fail_count: fails.length,
      not_measured: warns.length,
      max_pct: passes.length > 0
        ? Math.round(Math.max(...passes.map((p) => (p.actual / p.max) * 100)))
        : 0,
    },
  };
}

const gates = [
  runScript(
    "Workspace invariants",
    "scripts/sdk-2-0-pre-publish-check.mjs",
    (out) => ({ packages_scanned: extractInt(out, /Workspace packages scanned: (\d+)/) }),
  ),
  runBundleBudget(),
  runScript(
    "Stage 3 drift detector",
    "scripts/sdk-2-0-stage3-drift-detector.mjs",
    (out) => ({
      pairs_checked: extractInt(out, /Pairs checked: (\d+)/),
      known_divergences: extractInt(out, /Known divergences \(allowlisted\): (\d+)/),
      findings: extractInt(out, /Findings: (\d+)/),
    }),
  ),
  runScript(
    "Phase 6 rename scope",
    "scripts/phase6-rename-dry-run.mjs",
    (out) => ({ files_in_scope: extractInt(out, /(\d+) files would be touched/) }),
  ),
  runScript(
    "Phase 7 cohort scope",
    "scripts/phase7-cohort-analysis.mjs",
    (out) => {
      // phase7-cohort-analysis emits JSON consumers list on stdout
      // (human histogram + "Consumers found: N" goes to stderr).
      try {
        const arr = JSON.parse(out);
        return { consumers: Array.isArray(arr) ? arr.length : null };
      } catch {
        return { consumers: null };
      }
    },
  ),
];

const allReadOnlyPass = gates.every((g) => g.pass);

// Long-running gates (not invoked; shown for operator awareness).
const longRunning = [
  {
    label: "Cohort publish-readiness (publint + attw × 6)",
    estimate: "~5min",
    invoke: "pnpm run sdk-2-0:cohort:readiness",
  },
];

// Operator-driven steps requiring npm credentials.
const operatorSteps = [
  {
    label: "Phase 6 rename (apply)",
    preview: "pnpm run sdk-2-0:phase6:dry",
    apply: "node scripts/phase6-rename-write.mjs --write --backup",
  },
  {
    label: "Phase 7 peerDep bump (apply)",
    preview: "pnpm run sdk-2-0:phase7:peerdep-bump:dry",
    apply: "node scripts/phase7-peerdep-bump.mjs --write --backup",
  },
  {
    label: "Cohort npm publish",
    preview: "(none)",
    apply: "see docs/runbook/sdk-2-0-release.md",
  },
  {
    label: "Dogfood QA (TheoKit consumer)",
    preview: "(none)",
    apply: "cd ../theokit && pnpm install @theokit/sdk-core@2 && pnpm test",
  },
];

if (JSON_MODE) {
  console.log(
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        all_read_only_pass: allReadOnlyPass,
        gates,
        long_running: longRunning,
        operator_steps: operatorSteps,
      },
      null,
      2,
    ),
  );
} else {
  const now = new Date().toISOString();
  console.log(`# SDK 2.0 release-readiness status — ${now}`);
  console.log("");
  console.log("## Read-only gates (deterministic)");
  for (const g of gates) {
    const mark = g.pass ? "✓" : "✗";
    const metrics = Object.entries(g.metrics)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    console.log(`  ${mark} ${g.label.padEnd(28)} ${metrics}`);
  }
  console.log("");
  console.log("## Long-running gates (NOT run by default)");
  for (const lr of longRunning) {
    console.log(`  ⏸ ${lr.label}  (${lr.estimate})`);
    console.log(`        Run: ${lr.invoke}`);
  }
  console.log("");
  console.log("## Operator action required (needs credentials / coordination)");
  for (const op of operatorSteps) {
    console.log(`  ⏸ ${op.label}`);
    console.log(`        Preview: ${op.preview}`);
    console.log(`        Apply:   ${op.apply}`);
  }
  console.log("");
  if (allReadOnlyPass) {
    console.log("## Verdict: READ-ONLY GATES GREEN — operator clearance to proceed.");
  } else {
    console.log("## Verdict: AT LEAST ONE READ-ONLY GATE FAILED — release NOT ready.");
    for (const g of gates) {
      if (!g.pass) {
        console.log(`  ✗ ${g.label}: ${g.metrics.error ?? "(no stderr)"}`);
      }
    }
  }
}

process.exit(allReadOnlyPass ? 0 : 1);
