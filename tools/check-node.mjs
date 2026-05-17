#!/usr/bin/env node
// Node version pre-check used by example `predev` scripts.
//
// Reads `engines.node` from the workspace root package.json (canonical floor
// per ADR D01) and fails fast if the current Node version is older. The error
// message points to `nvm use` and explains why (better-sqlite3
// NODE_MODULE_VERSION mismatch when the binary was built for a different
// runtime).
//
// `.nvmrc` is a fuzzy hint for nvm (`22` accepts any installed 22.x). The
// authoritative floor is `engines.node` (`>=22.12.0`). This script trusts the
// floor, not the hint.
//
// Exit codes:
//   0 — Node version OK
//   1 — wrong Node
//   2 — engines.node missing or unparseable (defensive — not expected)

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

let required;
try {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
  const engineRange = pkg?.engines?.node;
  if (typeof engineRange !== "string") throw new Error("engines.node missing");
  // Parse the minimum from a >=X.Y.Z range. Anything fancier isn't supported
  // (and shouldn't be needed — we pin a floor, never a ceiling).
  const m = engineRange.match(/^>=\s*(\d+\.\d+\.\d+)$/);
  if (m === null) throw new Error(`unparseable engines.node "${engineRange}" (expected ">=X.Y.Z")`);
  required = m[1];
} catch (cause) {
  console.error(
    `[check-node] failed to read engines.node from ${ROOT}/package.json: ${cause instanceof Error ? cause.message : String(cause)}`,
  );
  process.exit(2);
}

const current = process.versions.node;

const cmp = (a, b) => {
  const [aM, am = "0", ap = "0"] = a.split(".");
  const [bM, bm = "0", bp = "0"] = b.split(".");
  return Number(aM) - Number(bM) || Number(am) - Number(bm) || Number(ap) - Number(bp);
};

if (cmp(current, required) >= 0) {
  process.exit(0);
}

const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

console.error("");
console.error(`${RED}${BOLD}Node ${required}+ required (engines.node), got v${current}${RESET}`);
console.error("");
console.error(`${DIM}Why this matters:${RESET}`);
console.error(`  ADR D01 pins Node 22.12+ across the SDK and examples.`);
console.error(`  Native deps like better-sqlite3 use a per-Node ABI; mixing Node`);
console.error(`  20 install with Node 22 dev (or vice-versa) breaks at runtime.`);
console.error("");
console.error(`${DIM}Fix:${RESET}`);
console.error(`  nvm use            # switches to the .nvmrc version`);
console.error(`  nvm install        # if you don't have v${required} yet`);
console.error("");
console.error(`Then re-run the same command.`);
console.error("");
process.exit(1);
