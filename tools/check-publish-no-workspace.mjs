#!/usr/bin/env node
/**
 * Refuse a `workspace:` leak BEFORE it becomes public (B-111).
 *
 * A published version cannot be fixed, only deprecated. If a manifest reaches npm still saying
 * `"@theokit/sdk": "workspace:^"`, every install of that version fails to resolve it, and the only
 * remedies are a new version plus a deprecation notice on the broken one. So the assertion has to
 * happen before the PUT, not after.
 *
 * ## Why this is two rules and not one
 *
 * `"@theokit/sdk": "workspace:^"` on disk is CORRECT — it is how a pnpm workspace expresses an
 * internal dependency, and 5 of this repo's 12 publishable packages carry one. What decides whether
 * it becomes a defect is the tool that publishes:
 *
 *   - `pnpm` resolves `workspace:` into a real range while packing. Safe.
 *   - `npm` ships the manifest verbatim. Broken, publicly, permanently.
 *
 * So a guard that only inspects the on-disk manifest would refuse correct repositories, and a guard
 * that only inspects a pnpm-packed tarball would pass while an operator typing `npm publish` in a
 * package directory breaks the release. Both checks below exist because either alone is blind to
 * the case the other catches.
 *
 * ## Why it is written rather than installed
 *
 * `publint` is the obvious candidate and was measured on 2026-08-11 against a manifest carrying
 * `"some-sibling": "workspace:^"`: it reported "All good!". It lints resolution and types, not the
 * workspace protocol. Nothing else installed here covers it either.
 *
 * The sibling repo `theokit` reached the same two-part rule independently (`scripts/
 * check-pack-no-workspace.mjs`, theokit#153). This is a deliberate second implementation and not an
 * oversight: the two repositories share no tooling package, and a rule that must run before a
 * publish cannot depend on something published by the thing it guards.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = join(REPO, "packages");

/** Dependency fields npm resolves at install time. `devDependencies` are not published. */
const RESOLVED_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"];

/** @returns every `[field, name, range]` in `manifest` whose range uses the workspace protocol. */
function workspaceRanges(manifest) {
  const found = [];
  for (const field of RESOLVED_FIELDS) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      if (typeof range === "string" && range.startsWith("workspace:")) {
        found.push({ field, name, range });
      }
    }
  }
  return found;
}

/**
 * The package manager running this publish, per npm's own env var.
 *
 * Absent when the script is invoked directly (a test, or `node tools/...`), which is why the
 * caller decides what an unknown agent means rather than this function guessing.
 */
function publishingAgent() {
  const ua = process.env.npm_config_user_agent ?? "";
  if (ua.startsWith("pnpm/")) return "pnpm";
  if (ua.startsWith("npm/")) return "npm";
  if (ua.startsWith("yarn/")) return "yarn";
  return null;
}

/**
 * @returns the `package.json` inside the tarball `pnpm pack` produces for `packageDir`.
 *
 * Both `pnpm` and `tar` are resolved through PATH, which SonarCloud raises as its "fixed,
 * unwriteable directories" hotspot. Reviewed and accepted for the same reason as the sibling
 * guard: this is a maintainer/CI release script in a repository whose entire toolchain arrives
 * through PATH, and anyone able to write to that PATH already controls the build — so pinning
 * absolute paths moves no risk while breaking every nvm and macOS checkout.
 *
 * `pnpm` specifically CANNOT be pinned even in principle: it is the tool under test here. The rule
 * this whole script enforces is that only pnpm rewrites the `workspace:` protocol while packing, so
 * the artifact must be produced by whichever pnpm the operator's publish will actually use. A
 * hardcoded path would verify a different binary than the one that ships the package.
 */
function packedManifest(packageDir) {
  const dest = mkdtempSync(join(tmpdir(), "wsguard-"));
  try {
    // Reviewed above: pnpm is the tool under test and cannot be pinned even in principle.
    execFileSync("pnpm", ["pack", "--pack-destination", dest], {
      // NOSONAR
      cwd: packageDir,
      stdio: ["ignore", "ignore", "pipe"],
    });
    const tarball = readdirSync(dest).find((f) => f.endsWith(".tgz"));
    if (!tarball) throw new Error(`pnpm pack produced no tarball in ${dest}`);
    // Same review; `tar` reads a tarball this process just created in a temp dir it owns.
    const raw = execFileSync("tar", ["-xzOf", join(dest, tarball), "package/package.json"], {
      // NOSONAR
      encoding: "utf8",
    });
    return JSON.parse(raw);
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
}

/** @returns absolute dirs of every publishable package, or just `only` when given. */
export function publishablePackages(only) {
  if (only) return [resolve(only)];
  return readdirSync(PACKAGES)
    .map((name) => join(PACKAGES, name))
    .filter((dir) => {
      try {
        return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).private !== true;
      } catch {
        return false;
      }
    });
}

/**
 * Check one package. Pure — returns problems instead of exiting, so tests can drive it.
 *
 * @param packageDir absolute path to the package
 * @param agent the publishing package manager, or null when unknown
 * @param opts.pack whether to also verify the packed tarball (skipped when only the manifest rule
 *   is under test, because packing is the slow part)
 * @returns array of human-readable problems; empty means safe to publish
 */
export function checkPackage(packageDir, agent, opts = {}) {
  const { pack = true } = opts;
  const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  if (manifest.private === true) return [];

  const problems = [];
  const onDisk = workspaceRanges(manifest);

  // Rule 1 — the tool. Only pnpm rewrites; anything else ships the manifest as written.
  if (onDisk.length > 0 && agent !== null && agent !== "pnpm") {
    problems.push(
      `${manifest.name}: REFUSING to publish with ${agent}. The manifest carries ` +
        `${onDisk.length} workspace: range(s) and only pnpm rewrites them while packing, so this ` +
        `publish would ship them verbatim:\n` +
        onDisk.map((d) => `    ${d.field}.${d.name} = ${d.range}`).join("\n") +
        `\n  Use: pnpm publish   (or \`pnpm release\`, which runs changeset publish)`,
    );
  }

  // Rule 2 — the artifact. Independent of rule 1: it catches a rewrite that silently stops working.
  if (pack) {
    const leaked = workspaceRanges(packedManifest(packageDir));
    if (leaked.length > 0) {
      problems.push(
        `${manifest.name}: the PACKED tarball still carries ${leaked.length} workspace: range(s). ` +
          `This is what would reach the registry:\n` +
          leaked.map((d) => `    ${d.field}.${d.name} = ${d.range}`).join("\n"),
      );
    }
  }

  return problems;
}

function main() {
  const only = process.argv[2];
  const agent = publishingAgent();
  const problems = publishablePackages(only).flatMap((dir) => checkPackage(dir, agent));

  if (problems.length > 0) {
    console.error(`\n✗ workspace: guard refused this publish\n`);
    for (const p of problems) console.error(`  ${p}\n`);
    console.error(
      `A published version cannot be fixed, only deprecated — which is why this runs before\n` +
        `the publish and not after. See tools/check-publish-no-workspace.mjs.\n`,
    );
    process.exit(1);
  }
  console.log(`✓ workspace: guard — no leak in any publishable manifest or tarball`);
}

// Only run when executed, so the exported functions stay importable from tests.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
