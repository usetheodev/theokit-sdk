#!/usr/bin/env node
/**
 * SDK 2.0 post-publish validation gate — verify the npm registry
 * state matches the workspace state after the cohort publish
 * (runbook Step 6).
 *
 * For each tracked workspace package, runs `npm view <pkg> version`
 * against the registry + compares to the workspace's local version
 * field. A mismatch means either (a) publish didn't propagate, (b)
 * publish failed silently, (c) workspace was edited post-publish
 * without re-publishing.
 *
 * Usage:
 *   node scripts/sdk-2-0-post-publish-check.mjs
 *
 *   # Limit to specific packages:
 *   node scripts/sdk-2-0-post-publish-check.mjs --only @theokit/sdk-core,@theokit/sdk-memory
 *
 *   # Network-free dry mode (skips npm view, prints what WOULD be checked):
 *   node scripts/sdk-2-0-post-publish-check.mjs --dry
 *
 * Exit code:
 *   0 — all packages match registry
 *   1 — at least one mismatch or invocation error
 *
 * Iter 90 — post-publish gate. Operators run this AFTER runbook
 * Step 6 (publish) and BEFORE Step 7 (dogfood QA). If it fails,
 * the registry needs a patch re-publish before consumers see the
 * inconsistent state.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".turbo",
  ".changeset",
  "coverage",
  ".vitest-cache",
  ".pnpm-store",
]);

// Default tracked packages — the SDK 2.0 cohort.
const DEFAULT_COHORT = [
  "@theokit/sdk",
  "@theokit/sdk-core",
  "@theokit/sdk-memory",
  "@theokit/sdk-budget",
  "@theokit/sdk-cache",
  "@theokit/sdk-handoff",
  "@theokit/sdk-tools",
];

const args = process.argv.slice(2);
const DRY_MODE = args.includes("--dry");
const ONLY_IDX = args.indexOf("--only");
const ONLY =
  ONLY_IDX >= 0 && args[ONLY_IDX + 1] !== undefined
    ? args[ONLY_IDX + 1].split(",").map((s) => s.trim()).filter(Boolean)
    : null;

const workspaceVersions = new Map();
const results = [];

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "EACCES" || err.code === "ENOENT") return;
    throw err;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && !entry.name.startsWith(".changeset")) {
      if (entry.name !== ".github") continue;
    }
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full);
    } else if (entry.isFile() && entry.name === "package.json") {
      await inspect(full);
    }
  }
}

async function inspect(path) {
  let stats;
  try {
    stats = await stat(path);
  } catch {
    return;
  }
  if (stats.size > 1_000_000) return;
  let content;
  try {
    content = await readFile(path, "utf8");
  } catch {
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return;
  }
  if (
    typeof parsed.name === "string" &&
    typeof parsed.version === "string"
  ) {
    workspaceVersions.set(parsed.name, parsed.version);
  }
}

function registryVersion(pkg) {
  // Use --silent so non-200 noise doesn't pollute stdout. We rely
  // on `npm view <pkg> version` returning the latest tag's version
  // on stdout, exit code != 0 if not found.
  const res = spawnSync("npm", ["view", pkg, "version", "--json"], {
    encoding: "utf8",
    timeout: 15000,
  });
  if (res.status !== 0) {
    return { found: false, error: res.stderr.trim().split("\n").slice(0, 2).join(" ") };
  }
  let parsed;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    parsed = res.stdout.trim();
  }
  if (typeof parsed === "string") return { found: true, version: parsed };
  return { found: true, version: String(parsed) };
}

function printReport() {
  console.log("# SDK 2.0 post-publish validation gate");
  console.log(`Mode: ${DRY_MODE ? "DRY (no npm view calls)" : "LIVE (queries npm registry)"}`);
  console.log("");

  const fails = results.filter((r) => r.status === "MISMATCH" || r.status === "NOT_FOUND");
  if (results.length === 0) {
    console.log("No cohort packages found in workspace.");
    return;
  }

  console.log(`## Cohort check (${results.length} packages)`);
  for (const r of results) {
    if (r.status === "SKIPPED_NOT_IN_WORKSPACE") {
      console.log(`  ${r.package.padEnd(28)}  (not in workspace, skipped)`);
    } else if (DRY_MODE) {
      console.log(
        `  ${r.package.padEnd(28)}  workspace=${r.workspace}  (would query registry)`,
      );
    } else {
      const marker = r.status === "MATCH" ? "✓" : "✗";
      const detail =
        r.status === "MATCH"
          ? `workspace=${r.workspace} registry=${r.registry}`
          : r.status === "NOT_FOUND"
            ? `workspace=${r.workspace} registry=NOT_FOUND (${r.error ?? "n/a"})`
            : `workspace=${r.workspace} registry=${r.registry}`;
      console.log(`  ${marker} ${r.package.padEnd(28)}  ${detail}`);
    }
  }

  if (DRY_MODE) {
    console.log("\n## Result: DRY (no network check performed).");
    return;
  }
  if (fails.length === 0) {
    console.log("\n## Result: PASS — all cohort packages match.");
  } else {
    console.log(`\n## Result: FAIL — ${fails.length} mismatches.`);
  }
}

async function main() {
  await walk(REPO_ROOT);
  const cohort = ONLY ?? DEFAULT_COHORT;
  for (const pkg of cohort) {
    const wsVersion = workspaceVersions.get(pkg);
    if (wsVersion === undefined) {
      results.push({ package: pkg, status: "SKIPPED_NOT_IN_WORKSPACE" });
      continue;
    }
    if (DRY_MODE) {
      results.push({ package: pkg, workspace: wsVersion, status: "DRY" });
      continue;
    }
    const reg = registryVersion(pkg);
    if (!reg.found) {
      results.push({
        package: pkg,
        workspace: wsVersion,
        status: "NOT_FOUND",
        error: reg.error,
      });
      continue;
    }
    if (reg.version === wsVersion) {
      results.push({
        package: pkg,
        workspace: wsVersion,
        registry: reg.version,
        status: "MATCH",
      });
    } else {
      results.push({
        package: pkg,
        workspace: wsVersion,
        registry: reg.version,
        status: "MISMATCH",
      });
    }
  }
  printReport();
  const fails = results.filter((r) => r.status === "MISMATCH" || r.status === "NOT_FOUND");
  process.exit(fails.length === 0 || DRY_MODE ? 0 : 1);
}

main().catch((err) => {
  console.error("post-publish-check failed:", err);
  process.exit(1);
});
