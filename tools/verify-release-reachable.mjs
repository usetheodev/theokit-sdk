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
 * ## Why `action_required`, and why an EMPTY payload is not "all clear"
 *
 * A freshly-opened pull request has checks that are `queued` or `in_progress`, and failing on those
 * would be a flaky gate — which `testing.md` § 6 calls a bug. `action_required` is different in
 * kind: it is terminal without a human, so it never becomes `success` on its own.
 *
 * That much held. What did not is the sentence this docblock used to carry — "observing it is never
 * a race". It named the wrong race. Measured on run 32918852952: the gate ran at ~01:24 and the
 * four check runs appeared at 01:35, so it saw NO checks and passed on a pull request that was
 * BLOCKED the whole time. The hazard is not that `action_required` changes under you; it is that it
 * does not exist yet when you look.
 *
 * So the verdict has three states, not two, and the run waits for the checks to appear before
 * concluding. If they never appear, that is a failure of its own: a required context with no run at
 * all blocks the merge exactly as surely as one waiting for approval, and it is what happens when
 * the pull request is authored with `GITHUB_TOKEN`, which by GitHub's own rule triggers no workflow.
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
/**
 * What this payload lets the run conclude.
 *
 * `absent` is deliberately not folded into `ok`: "no check has appeared yet" and "checks appeared
 * and none is stuck" are different facts, and collapsing them is exactly the bug that let a blocked
 * release report green.
 */
export function checkVerdict(payload) {
  const blocked = pendingApproval(payload);
  if (blocked.length > 0) return { state: "blocked", blocked };
  const runs = Array.isArray(payload?.check_runs) ? payload.check_runs : [];
  return runs.length === 0 ? { state: "absent", blocked: [] } : { state: "ok", blocked: [] };
}

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

/** How long to wait for GitHub to create the checks, and how often to look. */
const APPEAR_TIMEOUT_MS = 5 * 60_000;
const POLL_INTERVAL_MS = 15_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const jsonFlag = process.argv.indexOf("--json");
  if (jsonFlag !== -1) {
    return report(checkVerdict(JSON.parse(readFileSync(process.argv[jsonFlag + 1], "utf8"))));
  }

  // Wait for the checks to exist before judging them. Concluding on an empty payload is what let a
  // blocked release report green; a bounded wait is what separates "not yet" from "never".
  const deadline = Date.now() + APPEAR_TIMEOUT_MS;
  let verdict = checkVerdict(checkRunsFor(VERSION_BRANCH));
  while (verdict.state === "absent" && Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    verdict = checkVerdict(checkRunsFor(VERSION_BRANCH));
  }
  return report(verdict);
}

function report(verdict) {
  if (verdict.state === "ok") {
    console.log(
      `[release-reachable] PASS — checks on ${VERSION_BRANCH} are running or done, none waiting on approval.`,
    );
    return 0;
  }

  if (verdict.state === "absent") {
    console.error(
      `[release-reachable] ✗ no check ever appeared on ${VERSION_BRANCH}. The required contexts` +
        ` cannot pass, so the version pull request cannot be merged and nothing will publish.`,
    );
    console.error("");
    console.error("  A pull request authored with GITHUB_TOKEN triggers no workflow, by GitHub's");
    console.error("  own rule. That is the shape this looks like.");
  } else {
    console.error(
      `[release-reachable] ✗ ${verdict.blocked.length} check(s) on ${VERSION_BRANCH} are waiting on` +
        ` manual approval and will never run on their own:`,
    );
    for (const name of verdict.blocked) console.error(`      ${name}`);
    console.error("");
    console.error("  To ship THIS release, approve the pending runs:");
    console.error("    gh api -X POST repos/$GITHUB_REPOSITORY/actions/runs/<id>/approve");
  }

  console.error("");
  console.error("[release-reachable] FAIL — the release run itself is green, which is why this");
  console.error("  went unnoticed for eight days in 2026-08 (#388).");
  console.error("");
  console.error("  To stop it recurring, pick one — none of them belongs in a source file:");
  console.error("    · narrow `fork-pr-contributor-approval` so `github-actions[bot]` is exempt");
  console.error("    · give changesets/action a PAT or App token instead of GITHUB_TOKEN");
  console.error("    · publish straight from `main`, with no version pull request at all");
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main());
