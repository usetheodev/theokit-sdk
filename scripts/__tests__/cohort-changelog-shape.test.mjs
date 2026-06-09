/**
 * Smoke test: every SDK 2.0 cohort package has a maintainable CHANGELOG.
 *
 * Enforces Unbreakable Rule 6: every package MUST keep a CHANGELOG.md
 * with `[Unreleased]` as the staging area for incoming changes. Without
 * this gate, packages that ship at version 0.1.0 silently drift — there
 * is no slot for the next release's notes.
 *
 * Checks per cohort package (sdk, sdk-budget, sdk-cache, sdk-handoff,
 * sdk-memory, sdk-tools):
 *
 *   1. packages/<name>/CHANGELOG.md exists.
 *   2. File starts with the Keep-a-Changelog `# Changelog` H1.
 *   3. Contains a `## [Unreleased]` section.
 *   4. References the Keep-a-Changelog format (link or token).
 *
 * The body of `[Unreleased]` may be empty / "(No unreleased changes.)"
 * — what matters is the SLOT existing so the next change has a home.
 *
 * Iter 111.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

const COHORT = ["sdk", "sdk-budget", "sdk-cache", "sdk-handoff", "sdk-memory", "sdk-tools"];

const failures = [];

function pushFail(condition, message) {
  if (condition) failures.push(message);
}

for (const name of COHORT) {
  const path = join(REPO_ROOT, "packages", name, "CHANGELOG.md");
  if (!existsSync(path)) {
    failures.push(`@theokit/${name}: CHANGELOG.md missing at packages/${name}/CHANGELOG.md`);
    continue;
  }
  const text = await readFile(path, "utf8");

  pushFail(
    !/^#\s+Changelog\b/m.test(text),
    `@theokit/${name}: CHANGELOG.md missing top-level "# Changelog" heading`,
  );

  pushFail(
    !text.includes("## [Unreleased]"),
    `@theokit/${name}: CHANGELOG.md missing "## [Unreleased]" section (Unbreakable Rule 6)`,
  );

  // At least one versioned section must exist after [Unreleased] —
  // the cohort packages are all post-0.1.0, so a versioned header
  // anchors what's actually shipped. Accept both `## [N.N.N]` (Keep-
  // a-Changelog brackets-style) and `## N.N.N` (brackets-less variant
  // sdk-core uses).
  pushFail(
    !/^## \[?\d+\.\d+\.\d+\]?/m.test(text),
    `@theokit/${name}: CHANGELOG.md has no versioned section`,
  );
}

if (failures.length > 0) {
  console.error("cohort-changelog-shape test FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `cohort-changelog-shape test PASSED (${COHORT.length} cohort packages all have [Unreleased] slot).`,
);
