#!/usr/bin/env node

/**
 * After a release run that PREPARED a version instead of publishing one, prove the pull request it
 * left behind can actually be merged (#388).
 *
 * ## The failure this exists for, measured
 *
 * `changesets/action` has two outcomes. With a version bump already on `main` it publishes, and
 * `steps.changesets.outputs.published` is `'true'`. With changesets pending it instead opens (or
 * updates) a "Version Packages" pull request from `changeset-release/main` and reports success —
 * success meaning it PREPARED a version, not that it shipped one.
 *
 * That pull request is opened by `github-actions[bot]`, and this repository's Actions setting
 * `fork-pr-contributor-approval` is `first_time_contributors`. The bot is classified as one, so
 * every workflow on that pull request lands in `action_required` — created, never run, waiting on a
 * human. `main` requires `validate (node 22)`, `validate (node 22.12)`, `TruffleHog`,
 * `analyze (javascript-typescript)` and `analyze (actions)`; none of them can pass, so the pull
 * request is permanently `BLOCKED`.
 *
 * Measured on `changeset-release/main`: four runs `action_required` on 2026-08-17, and the pull
 * request (#313) still open eight days later. The registry served 4.54.0 while the tree said 4.55.0.
 *
 * ## Why a gate, when the fix is a setting
 *
 * Unblocking it is a repository-configuration decision — loosen the approval policy, give the
 * action a token that is not `GITHUB_TOKEN`, or publish straight from `main`. None of those belong
 * in a source file, and whichever is chosen, THIS defect survives it: every signal a maintainer
 * checks said fine. The release run was green, the merge to `main` succeeded, and the two checks
 * that do run on the release pull request both passed. The only place the failure was visible was
 * `npm view @theokit/sdk version`, which nobody thinks to run.
 *
 * So the gate does not try to unblock the release. It makes the stuck state SAY SO, in the run a
 * maintainer is already looking at, on the day it happens rather than eight days later.
 *
 * ## Why `action_required` and not "some check is not green"
 *
 * A freshly-opened pull request has checks that are `queued` or `in_progress`, and failing on those
 * would be a flaky gate — which `testing.md` § 6 calls a bug. `action_required` is different in
 * kind: it is terminal without a human. It never becomes `success` on its own, so observing it once
 * is enough, and observing it is never a race.
 *
 * Usage: node tools/verify-release-reachable.mjs [--json <path>]
 *   --json  read the check-run payload from a file instead of the API (tests, dry runs)
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** The branch `changesets/action` opens its version pull request from. */
export const VERSION_BRANCH = "changeset-release/main";

/**
 * The check runs on `sha` that are waiting on a human, given a GitHub check-runs payload.
 *
 * Pure so the interesting branch — a stuck pull request — is testable without a network, a token,
 * or a repository in that state. The API shell around it is one call.
 */
export function pendingApproval(payload) {
  const runs = Array.isArray(payload?.check_runs) ? payload.check_runs : [];
  return runs
    .filter((run) => run?.conclusion === "action_required")
    .map((run) => String(run.name ?? "(unnamed)"))
    .sort();
}

function checkRunsFor(ref) {
  const out = execFileSync(
    "gh",
    ["api", `repos/${process.env.GITHUB_REPOSITORY}/commits/${ref}/check-runs`, "--paginate"],
    { encoding: "utf8" },
  );
  return JSON.parse(out);
}

function main() {
  const jsonFlag = process.argv.indexOf("--json");
  const payload =
    jsonFlag !== -1
      ? JSON.parse(readFileSync(process.argv[jsonFlag + 1], "utf8"))
      : checkRunsFor(VERSION_BRANCH);

  const blocked = pendingApproval(payload);
  if (blocked.length === 0) {
    console.log(
      `[release-reachable] PASS — no check on ${VERSION_BRANCH} is waiting on manual approval.`,
    );
    return 0;
  }

  console.error(
    `[release-reachable] ✗ ${blocked.length} required check(s) on ${VERSION_BRANCH} are ` +
      `waiting on manual approval and will never run on their own:`,
  );
  for (const name of blocked) console.error(`      ${name}`);
  console.error("");
  console.error("[release-reachable] FAIL — the version pull request cannot be merged, so nothing");
  console.error("  will be published. The release run itself is green, which is why this went");
  console.error("  unnoticed for eight days in 2026-08 (#388).");
  console.error("");
  console.error("  To ship THIS release, approve the pending runs:");
  console.error("    gh api -X POST repos/$GITHUB_REPOSITORY/actions/runs/<id>/approve");
  console.error("");
  console.error("  To stop it recurring, pick one — none of them belongs in a source file:");
  console.error("    · narrow `fork-pr-contributor-approval` so `github-actions[bot]` is exempt");
  console.error("    · give changesets/action a PAT or App token instead of GITHUB_TOKEN");
  console.error("    · publish straight from `main`, with no version pull request at all");
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
