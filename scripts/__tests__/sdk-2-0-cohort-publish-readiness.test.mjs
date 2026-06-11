/**
 * SDK 2.0 cohort publish-readiness gate (iter 101).
 *
 * Generalizes iter 100's sdk-memory-specific check to cover the full
 * Phase 7 cohort: sdk-core + 5 sub-packages. Per-package:
 *   - dist/ artifacts present (build precondition)
 *   - publint "All good!"
 *   - attw 4/4 GREEN across node10 / node16 (CJS+ESM) / bundler
 *
 * Iter 9's progress entry shipped this gate for sdk-cache + sdk-tools
 * + sdk-handoff. Iter 100 added sdk-memory. Iter 101 closes the gap
 * with sdk-budget + sdk-core in one consolidated runner, plus
 * re-verifies the 4 prior packages so every cohort member passes the
 * same gate AT THE SAME TIME.
 *
 * Skipped: codemod-sdk-2-0 (iter 88) — it's a CLI tool with no `.d.ts`
 * surface; attw doesn't apply.
 *
 * Iter 101.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

const COHORT = [
  "sdk",
  "sdk-budget",
  "sdk-cache",
  "sdk-handoff",
  "sdk-memory",
  "sdk-tools",
];

const failures = [];
const results = [];

function checkPackage(pkgName) {
  const dir = join(REPO_ROOT, "packages", pkgName);
  const distFile = join(dir, "dist", "index.js");

  if (!existsSync(distFile)) {
    return {
      pkg: pkgName,
      publint: "SKIP (no dist/index.js)",
      attw: "SKIP",
      pass: false,
      reason: `dist/index.js missing — run \`pnpm -F @theokit/${pkgName} build\` first`,
    };
  }

  // publint
  const publintResult = spawnSync("npx", ["publint"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 60000,
  });
  const publintOut = (publintResult.stdout ?? "") + (publintResult.stderr ?? "");
  const publintPass = publintOut.includes("All good!");

  // attw
  const attwResult = spawnSync(
    "npx",
    ["attw", "--pack", ".", "--ignore-rules", "no-resolution"],
    { cwd: dir, encoding: "utf8", timeout: 60000 },
  );
  const attwOut = (attwResult.stdout ?? "") + (attwResult.stderr ?? "");
  // Strip full ANSI escape sequences (ESC + [...m). The earlier
  // version of this script missed the leading ESC and broke
  // regex matching against the colored output.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escapes
  const stripped = attwOut.replace(/\x1b\[[0-9;]*m/g, "");
  // attw uses two output formats: compact table (single-export
  // packages like sdk-memory) uses `│` column separators; verbose
  // format (multi-export packages like sdk-core) uses `: ` after the
  // mode label. The regex accepts EITHER.
  const modes = ["node10", "node16 (from CJS)", "node16 (from ESM)", "bundler"];
  let modesGreen = 0;
  for (const mode of modes) {
    const escMode = mode.replace(/[()]/g, "\\$&");
    const rowRe = new RegExp(`${escMode}\\s*(?:│|:)\\s*🟢`);
    if (rowRe.test(stripped)) modesGreen += 1;
  }
  const attwPass = modesGreen === 4;

  return {
    pkg: pkgName,
    publint: publintPass ? "All good!" : "FAILED",
    attw: attwPass ? "4/4 GREEN" : `${modesGreen}/4 GREEN`,
    pass: publintPass && attwPass,
    reason: !publintPass
      ? `publint did not report "All good!"`
      : !attwPass
        ? `attw ${modesGreen}/4 modes green`
        : "OK",
  };
}

console.log("# SDK 2.0 cohort publish-readiness gate");
console.log(`Cohort: ${COHORT.length} packages`);
console.log("");

for (const pkg of COHORT) {
  process.stdout.write(`▶ @theokit/${pkg} ... `);
  const r = checkPackage(pkg);
  results.push(r);
  if (!r.pass) failures.push(r);
  console.log(
    r.pass ? `✓ (publint: ${r.publint}, attw: ${r.attw})` : `✗ (${r.reason})`,
  );
}

console.log("");
console.log("## Summary");
console.log(`  Passed:  ${results.length - failures.length} / ${results.length}`);
console.log(`  Failed:  ${failures.length}`);

if (failures.length > 0) {
  console.log("");
  console.log("## Failure details");
  for (const f of failures) {
    console.log(`  - @theokit/${f.pkg}: ${f.reason}`);
  }
  process.exit(1);
}

console.log("");
console.log("All cohort packages publish-ready.");
