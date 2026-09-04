#!/usr/bin/env node
/**
 * Release guard — refuse to report success for a release that published nothing.
 *
 * Ported from usetheokit/theokit's scripts/verify-release-published.mjs, per its own release.yml
 * comment claiming theokit-sdk "already records" this guard — it did not. Measured here 2026-09-03:
 * `Release via Changesets (Harness)` reported success on run 33786821826 while
 * `@theokit/sdk@5.0.0-next.2` never reached the registry (E404), git tag and GitHub release both
 * present. `verify-release-refs.mjs` in this same pipeline checks the tag; nothing checked npm.
 * Filed as usetheokit/theokit-sdk#537.
 *
 * ## The failure this exists to prevent
 *
 * A publish pipeline that reports success when it publishes nothing is indistinguishable from one
 * that published — until the day it matters. "Nothing to publish" (every version already on the
 * registry) and "published" produce the same visible outcome unless something checks the registry
 * directly, which nothing in this pipeline did before this file.
 *
 * ## What it proves, and what it does not
 *
 * It proves the versions this release was supposed to publish are ON the registry. It does not
 * prove the tarball's contents, the provenance attestation, or that the right account published —
 * a guard that claimed more than it measures is the failure mode this repository keeps finding.
 *
 * An unreachable registry FAILS rather than passing: "I could not check" and "it published" are
 * different facts, and only one of them is safe to report as a release.
 *
 * Usage: `node tools/verify-release-published.mjs`
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function publishablePackages() {
  return readdirSync("packages", { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join("packages", e.name))
    .flatMap((dir) => {
      try {
        const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        if (pkg.private === true) return [];
        if (typeof pkg.name !== "string" || typeof pkg.version !== "string") return [];
        return [{ dir, name: pkg.name, version: pkg.version }];
      } catch {
        return [];
      }
    });
}

/**
 * Get the unpackedSize of a package from the registry, for backoff scaling.
 * Large packages (>5MB) indicate slower propagation on the npm registry.
 */
function getUnpackedSize({ name, version }) {
  try {
    const out = execFileSync(
      "npm",
      ["view", `${name}@${version}`, "dist.unpackedSize", "--prefer-online"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const size = Number(out.trim());
    return Number.isFinite(size) ? size : undefined;
  } catch {
    // If we cannot get the size, we do not scale the backoff; proceed with default delays.
    return undefined;
  }
}

function registryState({ name, version }) {
  try {
    // `--prefer-online` because `npm view` will otherwise answer from the local metadata cache,
    // which in a release job was populated moments before the publish.
    const out = execFileSync("npm", ["view", `${name}@${version}`, "version", "--prefer-online"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out.trim().length > 0 ? "published" : "absent";
  } catch (err) {
    const stderr = String(err?.stderr ?? "");
    if (stderr.includes("E404") || stderr.includes("404 Not Found")) return "absent";
    return `unknown: ${stderr.split("\n").find((l) => l.trim().length > 0) ?? "no detail"}`;
  }
}

/**
 * Does the tag for this release exist locally?
 *
 * Checked LOCALLY on purpose: changesets creates the tags before pushing them, so a local hit with
 * a failed push is precisely the state this distinguishes, and asking the remote would report the
 * same "absent" for both.
 */
function tagState({ name, version }) {
  const tag = `${name}@${version}`;
  try {
    const out = execFileSync("git", ["tag", "-l", tag], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out.trim().length > 0 ? "tagged" : "absent";
  } catch (err) {
    // A git that cannot answer is NOT evidence of an absent tag. Saying so keeps this from
    // reporting a failure it did not observe.
    return `unknown: ${String(err?.stderr ?? err).split("\n")[0]}`;
  }
}

const packages = publishablePackages();

if (packages.length === 0) {
  console.error("verify-release-published: found no publishable package — nothing was checked");
  process.exit(1);
}

/**
 * npmjs is eventually consistent: a publish that has already succeeded can answer E404 on the read
 * path for a few seconds, and `npm view` reports that identically to a version nobody published. So
 * `absent` is retried before it is believed. `unknown` is not: an unreachable registry is an
 * infrastructure fault, and the honest response is to say so now rather than after half a minute of
 * waiting for a network that is down.
 */
const RETRY_DELAYS_MS = (process.env.THEOKIT_RELEASE_VERIFY_DELAYS_MS ?? "2000,4000,8000,16000")
  .split(",")
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isFinite(n) && n >= 0);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let unknown = 0;
let pending = [];
for (const pkg of packages) {
  const state = registryState(pkg);
  if (state === "published") {
    console.log(`✓ ${pkg.name}@${pkg.version} is on the registry`);
  } else if (state === "absent") {
    pending.push(pkg);
  } else {
    unknown++;
    console.error(`? ${pkg.name}@${pkg.version} could not be checked — ${state}`);
  }
}

for (const delay of RETRY_DELAYS_MS) {
  if (pending.length === 0) break;

  // Scale backoff for large packages: npm registry eventual consistency
  // is slower for multi-megabyte tarballs. Observed: @theokit/sdk (12.9MB)
  // failed twice while smaller packages (276KB–1.25MB) succeeded in the same
  // batch. Backoff is scaled proportionally to dist.unpackedSize.
  let maxScaledDelay = delay;
  const scaledDelays = new Map();
  for (const pkg of pending) {
    const size = getUnpackedSize(pkg);
    let scaledDelay = delay;
    if (size !== undefined && size > 5_000_000) {
      // Scale by (size / 5MB), capped at 4x for packages >20MB
      const scale = Math.min(4, size / 5_000_000);
      scaledDelay = Math.round(delay * scale);
      scaledDelays.set(pkg.name, { size, scale: scale.toFixed(1), scaledDelay });
      maxScaledDelay = Math.max(maxScaledDelay, scaledDelay);
    }
  }

  if (scaledDelays.size > 0) {
    for (const [name, info] of scaledDelays) {
      console.log(
        `… ${name}: ${String(info.size)} bytes (${info.scale}x backoff multiplier) → ` +
          `${String(info.scaledDelay)}ms`,
      );
    }
  }

  console.log(
    `… ${String(pending.length)} version(s) not visible yet; the registry is eventually ` +
      `consistent, so waiting ${String(maxScaledDelay)}ms and re-reading before calling them unpublished`,
  );
  await sleep(maxScaledDelay);
  const stillPending = [];
  for (const pkg of pending) {
    if (registryState(pkg) === "published") {
      console.log(`✓ ${pkg.name}@${pkg.version} is on the registry (after a retry)`);
    } else {
      stillPending.push(pkg);
    }
  }
  pending = stillPending;
}

const missing = pending.length;
for (const pkg of pending) {
  console.error(`✗ ${pkg.name}@${pkg.version} was NOT published`);
}

// A push that fails after a successful publish leaves the run red and indistinguishable from one
// that published nothing — the wrong thing to conclude. An operator who concludes it would re-cut a
// release against a registry that already has the version.
const untagged = [];
const untagStateUnknown = [];
for (const pkg of packages) {
  const state = tagState(pkg);
  if (state === "tagged") continue;
  if (state.startsWith("unknown")) untagStateUnknown.push({ ...pkg, state });
  else untagged.push({ ...pkg, state });
}

for (const pkg of untagStateUnknown) {
  console.warn(`⚠ ${pkg.name}@${pkg.version}: could not read the tag — ${pkg.state}`);
}

if (untagged.length > 0 && missing === 0 && unknown === 0) {
  console.error("");
  for (const pkg of untagged) {
    console.error(`✗ ${pkg.name}@${pkg.version} WAS published, and its tag is ${pkg.state}`);
  }
  console.error(
    "\nThe publish succeeded and the tagging did not — these versions are on the registry with no\n" +
      "tag pointing at the commit they came from. This is NOT a failed release: do not re-cut it.\n" +
      "Create the tags against the commit this run published from and push them:\n" +
      untagged
        .map((p) => `    git tag -a "${p.name}@${p.version}" <sha> -m "${p.name}@${p.version}"`)
        .join("\n"),
  );
  process.exit(1);
}

if (missing > 0 || unknown > 0) {
  console.error(
    `\nThis release wrote a CHANGELOG entry for ${String(missing + unknown)} package(s) ` +
      "that are not on the registry. A green pipeline that published nothing is exactly\n" +
      "usetheokit/theokit-sdk#537 — the trusted-publisher configuration on npmjs.com is the first\n" +
      "thing worth checking.",
  );
  process.exit(1);
}
