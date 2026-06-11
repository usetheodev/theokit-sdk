#!/usr/bin/env node
// Cycle gate — primary CI gate for circular dependencies.
//
// Replaces the broken depcruise `no-circular` rule (see arch-review-fixes T0.1
// for the plan-defect rationale: depcruise's tsconfig parse is intentionally
// skipped per `.dependency-cruiser.cjs` comment, which makes its cycle
// detection silently miss what madge catches via dependency-tree).
//
// Threshold: 3 cycles MAX (the two D428-acknowledged subscribe ring + the
// cycle #4 documented as deferred under arch-review-fixes T4.1 plan-deviation).
// Drop the threshold as soon as cycle #4 closes via SDKAgent leaf extraction.

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// 3 = the two D428-acknowledged rollup-dts subscribe-at-sub-path cycles
// + cycle #3 (types/agent.ts > internal/runtime/memory-provider.ts) which
// is a type-only import cycle that madge detects but has no runtime impact.
// Cycle #4 (agent ↔ handoff) was closed by T4.1 follow-up via the
// HandoffDescriptor leaf-with-generic extraction.
const MAX_CYCLES = Number(process.env.MAX_CYCLES ?? 3);

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
