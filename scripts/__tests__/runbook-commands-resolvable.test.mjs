/**
 * Smoke test: every command the SDK 2.0 release runbook prescribes
 * must resolve to a real artifact on disk.
 *
 * Runbooks rot silently — operators discover a renamed script only
 * when they sit down to execute a release. This gate pins the
 * runbook ↔ script-tree contract.
 *
 * Checks performed against docs/runbook/sdk-2-0-release.md:
 *
 *   1. Every `node scripts/<path>.mjs` reference resolves to an
 *      existing file (no renames left behind).
 *   2. Every `pnpm --filter @theokit/<name>` package reference
 *      resolves to a real package.json in packages/<name>/.
 *
 * Iter 108.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const RUNBOOK = join(REPO_ROOT, "docs", "runbook", "sdk-2-0-release.md");

const failures = [];

function pushFail(condition, message) {
  if (condition) failures.push(message);
}

const text = await readFile(RUNBOOK, "utf8");

// 1) Extract every `node scripts/<...>.mjs` reference.
// Dedup so the same command repeated across sections is reported once.
const scriptRefs = new Set();
const scriptRe = /node\s+(scripts\/[\w./-]+\.mjs)\b/g;
let m;
while ((m = scriptRe.exec(text)) !== null) {
  scriptRefs.add(m[1]);
}

pushFail(
  scriptRefs.size === 0,
  "no `node scripts/<x>.mjs` commands found in runbook — extractor regex broken?",
);

for (const rel of scriptRefs) {
  const abs = join(REPO_ROOT, rel);
  pushFail(
    !existsSync(abs),
    `runbook references missing script: ${rel} (expected at ${abs})`,
  );
}

// 2) Extract `pnpm --filter @theokit/<name>` references.
const pkgRefs = new Set();
const filterRe = /pnpm\s+--filter\s+["']?@theokit\/([\w-]+)["']?/g;
let pm;
while ((pm = filterRe.exec(text)) !== null) {
  pkgRefs.add(pm[1]);
}

pushFail(
  pkgRefs.size === 0,
  "no `pnpm --filter @theokit/<x>` references found in runbook — extractor regex broken?",
);

// Map @theokit/<name> → packages/<name>/package.json (sdk-core lives at
// packages/sdk/package.json — it ships as @theokit/sdk today and becomes
// @theokit/sdk-core after Phase 6 rename, so we accept either directory).
for (const name of pkgRefs) {
  // sdk-core is a special case — pre-rename the package on disk is sdk.
  const candidates =
    name === "sdk-core" ? ["sdk", "sdk-core"] : [name];
  const found = candidates.some((dir) =>
    existsSync(join(REPO_ROOT, "packages", dir, "package.json")),
  );
  pushFail(
    !found,
    `runbook references missing workspace package @theokit/${name} (tried ${candidates.map((c) => `packages/${c}/package.json`).join(", ")})`,
  );
}

if (failures.length > 0) {
  console.error("runbook commands resolvable test FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  console.error(`\nscript refs (${scriptRefs.size}):`);
  for (const r of [...scriptRefs].sort()) console.error(`  - ${r}`);
  console.error(`\npackage refs (${pkgRefs.size}):`);
  for (const r of [...pkgRefs].sort()) console.error(`  - @theokit/${r}`);
  process.exit(1);
}

console.log(
  `runbook commands resolvable test PASSED (${scriptRefs.size} scripts + ${pkgRefs.size} packages all resolve).`,
);
