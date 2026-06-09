/**
 * sdk-memory publish-readiness smoke test (iter 100).
 *
 * Locks in publint + attw against `@theokit/sdk-memory` so any future
 * change to the package layout that breaks publish-readiness fails CI
 * before merge.
 *
 * Mirrors iter 9's Phase 7 prep gate pattern from the progress doc:
 * + publint "All good!"
 * + attw 4/4 GREEN across node10 / node16 (CJS+ESM) / bundler
 *
 * Runs in CI for every PR touching:
 * - packages/sdk-memory/package.json
 * - packages/sdk-memory/dist/**
 * - packages/sdk-memory/src/**
 *
 * Iter 100.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SDK_MEMORY_DIR = join(__dirname, "..", "..", "packages", "sdk-memory");

const failures = [];

// Sanity: dist/ must exist (publint + attw need built artifacts).
if (!existsSync(join(SDK_MEMORY_DIR, "dist", "index.js"))) {
  console.error(
    "ERROR: packages/sdk-memory/dist/index.js missing — run `pnpm -F @theokit/sdk-memory build` first.",
  );
  process.exit(2);
}

// 1) publint must report "All good!".
const publintResult = spawnSync(
  "npx",
  ["publint"],
  { cwd: SDK_MEMORY_DIR, encoding: "utf8", timeout: 60000 },
);

if (publintResult.status !== 0) {
  failures.push(`publint exit: ${publintResult.status}`);
}

const publintOut = (publintResult.stdout ?? "") + (publintResult.stderr ?? "");
if (!publintOut.includes("All good!")) {
  failures.push(`publint did not report "All good!"\n${publintOut.slice(0, 800)}`);
}

// 2) attw must show 4/4 GREEN across resolution modes.
const attwResult = spawnSync(
  "npx",
  ["attw", "--pack", ".", "--ignore-rules", "no-resolution"],
  { cwd: SDK_MEMORY_DIR, encoding: "utf8", timeout: 60000 },
);

if (attwResult.status !== 0) {
  failures.push(`attw exit: ${attwResult.status}`);
}

const attwOut = (attwResult.stdout ?? "") + (attwResult.stderr ?? "");
// attw renders unicode green/red dots. Strip ANSI codes for matching.
const stripped = attwOut.replace(/\[[0-9;]*m/g, "");

// All 4 rows should report green (🟢) for both the import + JSON columns.
const modes = ["node10", "node16 (from CJS)", "node16 (from ESM)", "bundler"];
for (const mode of modes) {
  // Look for the row: `│ <mode> │ 🟢...`. Need to match across whitespace.
  const rowRe = new RegExp(`${mode.replace(/[()]/g, "\\$&")}\\s*│\\s*🟢`);
  if (!rowRe.test(stripped)) {
    failures.push(`attw mode "${mode}" not green`);
  }
}

if (failures.length > 0) {
  console.error("sdk-memory publish-readiness FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  if (publintOut.length > 0) {
    console.error("\npublint stdout (truncated):");
    console.error(publintOut.slice(0, 600));
  }
  if (attwOut.length > 0) {
    console.error("\nattw stdout (truncated):");
    console.error(attwOut.slice(0, 1200));
  }
  process.exit(1);
}

console.log(
  "sdk-memory publish-readiness PASSED (publint 'All good!' + attw 4/4 GREEN).",
);
