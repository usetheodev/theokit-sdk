#!/usr/bin/env node
// Cycle gate — primary CI gate for circular dependencies.
//
// Replaces the broken depcruise `no-circular` rule (see arch-review-fixes T0.1
// for the plan-defect rationale: depcruise's tsconfig parse is intentionally
// skipped per `.dependency-cruiser.cjs` comment, which makes its cycle
// detection silently miss what madge catches via dependency-tree).
//
// Threshold: 0 cycles (SE45 — all import cycles eliminated). The three cycles
// that previously sat at the ≤3 gate were closed by SE45:
//   1. types/run.ts -> tool-result-guard   (ToolResultGuardOptions -> types/, cycle 1)
//   2. types/agent.ts <-> memory-provider   (SDKAgent cluster -> types/sdk-agent.ts leaf, cycle 2)
//   3. a2a/subagent <-> agent (facade)       (dynamic import -> getAgentFacade() DIP seam, cycle 3)
// The gate now enforces 0: any newly-introduced cycle fails the build.

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// 0 — SE45 eliminated all madge import cycles in packages/sdk/src.
const MAX_CYCLES = Number(process.env.MAX_CYCLES ?? 0);

const result = spawnSync(
  "pnpm",
  ["exec", "madge", "--circular", "--extensions", "ts,tsx", "packages/sdk/src"],
  { cwd: ROOT, encoding: "utf8", timeout: 90_000 },
);

const output = (result.stdout ?? "") + (result.stderr ?? "");
const cycleLines = output
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => /^\d+\)/.test(l));

const count = cycleLines.length;

console.log(`madge --circular reported ${count} cycle(s):`);
for (const line of cycleLines) console.log(`  ${line}`);
console.log(`gate threshold: ≤ ${MAX_CYCLES}`);

if (count > MAX_CYCLES) {
  console.error(`✗ Cycle gate FAILED: ${count} cycles exceed the threshold of ${MAX_CYCLES}.`);
  process.exit(1);
}

console.log("✓ Cycle gate passed.");
process.exit(0);
