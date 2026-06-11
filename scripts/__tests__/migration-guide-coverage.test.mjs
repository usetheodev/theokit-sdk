/**
 * Smoke test: MIGRATION.md documents every import shape the codemod
 * rewrites.
 *
 * Pins the MIGRATION.md ↔ codemod test contract — if a developer
 * adds a new shape to the codemod test (iter 104's
 * testEdgeCaseImportShapes) without updating MIGRATION.md, consumers
 * are left surprised when their unfamiliar import shape gets touched.
 *
 * The test reads MIGRATION.md and asserts every canonical shape
 * keyword appears in the table prose. It is intentionally loose
 * (substring match) — phrasing tweaks don't break it, but dropping
 * a whole pattern does.
 *
 * Iter 109.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const MIGRATION = join(REPO_ROOT, "MIGRATION.md");

// Canonical patterns the codemod handles. Each must appear in
// MIGRATION.md by name. The expected fragments are intentionally
// the table-cell rendition (lowercase + dashed) so phrasing tweaks
// to surrounding prose don't break the test, but dropping a whole
// pattern does.
const PATTERNS = [
  { name: "Bare specifier", fragments: ['from "@theokit/sdk"'] },
  { name: "Sub-path", fragments: ["@theokit/sdk/agent"] },
  { name: "Single-quoted", fragments: ["'@theokit/sdk'"] },
  { name: "Type-only", fragments: ["import type"] },
  { name: "Namespace", fragments: ["import * as"] },
  { name: "Re-export", fragments: ["export { X } from"] },
  { name: "Dynamic", fragments: ['await import("@theokit/sdk")'] },
  // package.json blocks the codemod also rewrites:
  { name: "package.json blocks", fragments: ["peerDependenciesMeta"] },
];

const text = await readFile(MIGRATION, "utf8");
const failures = [];

for (const { name, fragments } of PATTERNS) {
  for (const fragment of fragments) {
    if (!text.includes(fragment)) {
      failures.push(`pattern "${name}": MIGRATION.md missing fragment "${fragment}"`);
    }
  }
}

// Also assert the contract reference: the doc should point at the
// canonical test file (so consumers who want the source of truth
// know where to look).
if (!text.includes("packages/codemod-sdk-2-0/tests/codemod.test.mjs")) {
  failures.push("MIGRATION.md does not reference the canonical codemod test path");
}

if (failures.length > 0) {
  console.error("migration-guide-coverage test FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `migration-guide-coverage test PASSED (${PATTERNS.length} patterns documented + canonical test referenced).`,
);
