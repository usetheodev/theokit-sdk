#!/usr/bin/env node
/**
 * Refuse a release PR that would re-release work already shipped (B-109).
 *
 * `changesets/action` runs on `push: [main]`. It opens a "Version Packages" PR into `main`, and it
 * is THAT PR which consumes the `.changeset/*.md` files and bumps every `package.json`. Nothing
 * carries either back to `develop`, so `develop` falls one release further behind on every cut.
 *
 * The drift is not merely untidy. Measured on 2026-08-11, immediately before cutting a security
 * release: `develop` was 10 commits behind `main`, still declared `4.40.0` against main's `4.41.0`,
 * and still held three changesets that `4.41.0` had already consumed. Opening `develop → main` in
 * that state would have re-added all three, and the next `changeset version` would have re-released
 * three shipped features as fresh minors with duplicated CHANGELOG entries. A wrong version on npm
 * cannot be fixed — only deprecated.
 *
 * It was avoided that day only because someone happened to look. This script is what looks.
 *
 * ## The rule
 *
 * A changeset file is CONSUMED when a "Version Packages" merge deletes it from `main`. So for every
 * `.changeset/*.md` present on the PR head, ask git whether `main` has ever deleted that exact
 * path. If it has, the file is a resurrection of shipped work rather than a new change.
 *
 * This is a question about history, not about content, which is what makes it cheap and exact — no
 * parsing of changeset bodies, no guessing at which release absorbed what.
 *
 * A legitimate new change never trips it: `changeset add` generates a fresh random name, and a name
 * main has deleted is by definition one that already went out.
 */

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The repository root, resolved from THIS FILE rather than from the caller's cwd.
 *
 * Load-bearing. Every git call below names `.changeset/`, and git resolves a pathspec relative to
 * the working directory — so running from `packages/sdk` asked about `packages/sdk/.changeset/`,
 * found nothing, and reported an empty list. For this guard, empty means "all clear": it would have
 * passed a re-release silently, from any subdirectory, which is the one failure mode a guard must
 * not have. Caught by a test running under vitest's cwd, not by reading.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** @returns stdout, trimmed. Throws with git's stderr attached, so a failure is diagnosable. */
function git(args, opts = {}) {
  return execFileSync("git", args, { encoding: "utf8", cwd: REPO_ROOT, ...opts }).trim();
}

/** @returns every `.changeset/*.md` entry present at `ref` (excluding the upstream README). */
export function changesetsAt(ref) {
  let out;
  try {
    out = git(["ls-tree", "-r", "--name-only", ref, ".changeset/"]);
  } catch {
    return [];
  }
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.endsWith(".md") && !l.endsWith("README.md"));
}

/**
 * Has `baseRef` ever DELETED this path?
 *
 * `--diff-filter=D` over the base's own history answers exactly "was this consumed on the release
 * line", which is the question — not "does it exist now", which a plain `ls-tree` would answer and
 * which is true of every un-consumed changeset too.
 */
export function wasDeletedOn(baseRef, path) {
  try {
    return git(["log", baseRef, "--diff-filter=D", "--format=%H", "--", path]).length > 0;
  } catch {
    return false;
  }
}

/**
 * @returns the changeset paths on `headRef` that `baseRef` has already consumed. Empty means the PR
 *   is safe to merge as far as this check is concerned.
 */
export function reconsumedChangesets(baseRef, headRef) {
  return changesetsAt(headRef).filter((p) => wasDeletedOn(baseRef, p));
}

function main() {
  const base = process.argv[2] ?? "origin/main";
  const head = process.argv[3] ?? "HEAD";

  const offenders = reconsumedChangesets(base, head);
  if (offenders.length === 0) {
    console.log(`✓ no changeset on ${head} has already been consumed by ${base}`);
    return;
  }

  console.error(`\n✗ this merge would RE-RELEASE work already shipped\n`);
  console.error(
    `  ${offenders.length} changeset file(s) on ${head} were already consumed by a\n` +
      `  "Version Packages" merge on ${base}:\n`,
  );
  for (const p of offenders) console.error(`    ${p}`);
  console.error(
    `\n  Merging this would make the next \`changeset version\` publish those changes again as\n` +
      `  fresh versions, with duplicated CHANGELOG entries. A wrong version on npm cannot be\n` +
      `  fixed, only deprecated.\n` +
      `\n  Cause: ${base} is ahead of ${head} and the release bump was never carried back.\n` +
      `  Fix:   back-merge ${base} into ${head} first, which deletes the consumed files.\n`,
  );
  process.exit(1);
}

if (process.argv[1]?.endsWith("check-no-reconsumed-changesets.mjs")) {
  main();
}
