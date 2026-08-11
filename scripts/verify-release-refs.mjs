#!/usr/bin/env node
/**
 * After a publish, prove the release refs reached the remote (B-114).
 *
 * `changeset publish` creates one annotated tag per published package and pushes them. It reports
 * success on its own exit code, and an exit code is not evidence a ref was transferred.
 *
 * ## The failure this exists for, measured
 *
 * `git push` contacts the remote BEFORE running `pre-push`, and `pre-push` runs the full
 * `pnpm validate` — around eleven minutes. By the time the hook passes and the transfer begins, the
 * server has dropped the idle connection, so git dies of SIGPIPE (exit 141) SILENTLY: no error
 * text, nothing transferred, and output that ends in `✓ pre-push gates passed` as if it had worked.
 * Piping the command then hides the 141 behind the pipeline's last exit status.
 *
 * Observed 2026-08-11 first on a tag push, misdiagnosed twice (the `@` in the refname, then a lost
 * stdout reader), and finally reproduced on a plain branch name with the connection timeout as the
 * cause. Controlled experiment on one tree: eleven minutes and exit 141 having transferred nothing,
 * versus 2.3 seconds once the gate was already green.
 *
 * A missing release tag is not noticed on the day. It is noticed weeks later by whoever is
 * bisecting, and by then the version it should have marked is ambiguous.
 *
 * ## Where it runs, and why not inside `pnpm release`
 *
 * As its own step in the release workflow, AFTER the changesets action. `changeset publish` creates
 * the tags; the ACTION pushes them, in a step of its own once publish returns. Wiring the check
 * into `pnpm release` therefore ran it before the pusher and failed every release — measured on
 * 4.45.0, where the tag it reported missing was on the remote moments later. A gate that fails
 * every time is a gate people learn to ignore, which is worse than no gate.
 *
 * Locally it is `pnpm verify:refs`, run after a manual publish. There it CAN legitimately fail:
 * `changeset publish` leaves the tags for you to push, and the refusal prints the exact command.
 *
 * The check is against the REMOTE, deliberately: `git tag --list` would answer from the local
 * repository, which is exactly the thing whose word is not being taken.
 */

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function git(args) {
  // PATH resolution, reviewed as in the sibling release guards: this is maintainer/CI tooling in a
  // repository whose entire toolchain arrives through PATH, and anyone able to write to that PATH
  // already controls the build. The marker sits on the flagged line because Sonar ignores it
  // anywhere else — learned the hard way on `check-no-reconsumed-changesets.mjs`.
  return execFileSync("git", args, { encoding: "utf8", cwd: REPO_ROOT }).trim(); // NOSONAR
}

/**
 * Resolve `rev` to a commit, accepting a bare tag NAME as well as a revision.
 *
 * `@` carries meaning in git's revision syntax (`@` alone is HEAD, `name@{…}` is a reflog), so a
 * changesets tag like `@theokit/sdk@4.44.0` is rejected as a malformed object name unless it is
 * spelled `refs/tags/…`. Accepting both spellings is what makes this callable with the name a
 * release actually prints.
 *
 * THROWS when the revision cannot be resolved. Returning a sentinel here is what the first version
 * did, and an unresolvable ref then reported a clean release — the same silent-pass shape this file
 * exists to remove.
 */
function resolveRev(rev) {
  for (const candidate of [rev, `refs/tags/${rev}`]) {
    try {
      return git(["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`]);
    } catch {
      // try the next spelling
    }
  }
  throw new Error(`cannot resolve ${JSON.stringify(rev)} to a commit in this repository`);
}

/**
 * Tags that point at `since`, in the shape `changeset publish` creates (`@scope/name@version`).
 *
 * @returns tag names, sorted.
 * @throws when `since` does not resolve — see {@link resolveRev}.
 */
export function localReleaseTags(since = "HEAD") {
  const commit = resolveRev(since);
  return git(["tag", "--points-at", commit])
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l.includes("@"))
    .sort();
}

/** @returns the tag names the remote actually has, as a Set. */
export function remoteTags(remote = "origin") {
  let out;
  try {
    out = git(["ls-remote", "--tags", remote]);
  } catch (err) {
    // Cannot reach the remote — "could not check", which is NOT the same as "everything is there".
    // Surfacing it as a distinct condition is the whole point of this file.
    throw new Error(
      `cannot reach ${remote} to verify release refs: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`,
    );
  }
  const names = new Set();
  for (const line of out.split("\n")) {
    const ref = line.split("\t")[1];
    if (ref === undefined) continue;
    // Skip the peeled `^{}` entries — they duplicate the annotated tag's own ref.
    if (ref.endsWith("^{}")) continue;
    names.add(ref.replace("refs/tags/", ""));
  }
  return names;
}

/**
 * @returns the local release tags at `since` that the remote does NOT have. Empty means every one
 *   of them landed.
 */
export function missingOnRemote(since = "HEAD", remote = "origin") {
  const local = localReleaseTags(since);
  if (local.length === 0) return [];
  const onRemote = remoteTags(remote);
  return local.filter((t) => !onRemote.has(t));
}

function main() {
  const since = process.argv[2] ?? "HEAD";
  const remote = process.argv[3] ?? "origin";

  let missing;
  let local;
  try {
    local = localReleaseTags(since);
    missing = missingOnRemote(since, remote);
  } catch (err) {
    console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}\n`);
    // Exit 2 — "could not check" is a different fact from "checked, and refs are missing", and a
    // release path that collapsed the two would report an unreachable remote as a clean release.
    process.exit(2);
  }

  if (local.length === 0) {
    console.log(`✓ no release tags at ${since} — nothing to verify`);
    return;
  }
  if (missing.length === 0) {
    console.log(`✓ all ${String(local.length)} release tag(s) at ${since} are on ${remote}`);
    return;
  }

  console.error(`\n✗ ${String(missing.length)} release tag(s) never reached ${remote}\n`);
  for (const t of missing) console.error(`    ${t}`);
  console.error(
    `\n  The publish reported success and these refs did not transfer. That happens silently:\n` +
      `  git contacts the remote BEFORE pre-push runs, the hook takes minutes, and the idle\n` +
      `  connection is dropped before the transfer — git then dies of SIGPIPE (141) with no\n` +
      `  message. A missing release tag is noticed weeks later, by whoever is bisecting.\n` +
      `\n  Push them explicitly and re-run this check:\n` +
      missing.map((t) => `    git push ${remote} "refs/tags/${t}"`).join("\n") +
      `\n`,
  );
  process.exit(1);
}

if (process.argv[1]?.endsWith("verify-release-refs.mjs")) {
  main();
}
