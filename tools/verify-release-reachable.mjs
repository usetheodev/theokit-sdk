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
import { readdirSync, readFileSync } from "node:fs";

/**
 * Are there changesets still waiting to become a release?
 *
 * Takes the directory LISTING rather than reading the disk, so the interesting cases are testable
 * without a repository in each state. `config.json` and `README.md` are the directory's furniture;
 * every other `.md` is a pending changeset.
 *
 * This is what separates the two situations the workflow's `published != 'true'` condition covers
 * and this gate used to collapse into one. With changesets pending, a version pull request should
 * exist and its absence is the defect this gate was written for. With none pending, no pull request
 * was ever meant to exist and there is nothing to release — measured on the 4a49e7d8 run, where the
 * gate failed a release whose own log said "No changesets found" and whose every package was
 * already on npm.
 *
 * Checked here rather than by tightening the workflow's `if:` so the tool is correct on its own and
 * cannot be re-broken by a condition edited in a file that does not sit beside these tests.
 */
export function hasPendingChangesets(entries) {
  return entries.some((name) => name.endsWith(".md") && name !== "README.md");
}

/** The branch `changesets/action` opens its version pull request from. */
export const VERSION_BRANCH = "changeset-release/main";

/**
 * The check runs on `sha` that are waiting on a human, given a GitHub check-runs payload.
 *
 * Pure so the interesting branch — a stuck pull request — is testable without a network, a token,
 * or a repository in that state. The API shell around it is one call.
 */
/**
 * The pull-request states from which a merge can actually proceed.
 *
 * `UNSTABLE` is in: it means a check that is NOT required to merge is failing, which is a thing to
 * look at but not a thing that blocks the release. `HAS_HOOKS` is a clean state with a pre-receive
 * hook attached. Everything else — `DIRTY`, `BEHIND`, `DRAFT`, `BLOCKED` — cannot merge as it
 * stands, and the list is an allowlist rather than a denylist so a state GitHub adds later is
 * treated as blocking until someone looks at it.
 */
const MERGEABLE_STATES = new Set(["CLEAN", "UNSTABLE", "HAS_HOOKS"]);

/**
 * What the run can conclude, from GitHub's OWN answer to "can this pull request merge".
 *
 * This replaced a predicate that counted check runs, and the replacement is the point. The old one
 * asked "did any check appear?" and answered `ok` for a non-empty payload. Measured on the 4.57.0
 * release: `changeset-release/main` carried exactly two Socket Security checks, both green, neither
 * required on `main` — while the five that ARE required had never been created, because the pull
 * request was authored by `GITHUB_TOKEN`. Nothing was `action_required`, the payload was not empty,
 * and the gate reported a reachable release on a pull request GitHub called `BLOCKED`.
 *
 * Counting checks was a partial reimplementation of mergeability, and it disagreed with the real one
 * in exactly the case the gate exists for. `mergeStateStatus` is the authoritative answer, so the
 * gate asks for it instead of deriving a worse one.
 *
 * `absent` survives, and still means "too early to tell": `UNKNOWN` is what GitHub returns while it
 * is still computing mergeability. Folding it into `ok` would restore the original race — the gate
 * running before the answer exists and reading the silence as consent.
 *
 * `blocked` carries the names of any check waiting on a human, when there are any. Often there are
 * none: a required check that was never created cannot be `action_required`, so an empty list here
 * is itself the diagnosis, and the caller says so rather than printing nothing.
 */
export function mergeVerdict(mergeStateStatus, payload) {
  if (mergeStateStatus === "UNKNOWN") {
    return { state: "absent", blocked: pendingApproval(payload), stalled: [] };
  }
  if (MERGEABLE_STATES.has(mergeStateStatus)) return { state: "ok", blocked: [], stalled: [] };
  return {
    state: "blocked",
    blocked: pendingApproval(payload),
    stalled: neverConcluded(payload),
  };
}

/**
 * Checks that were CREATED and never reached a conclusion, on a pull request that cannot merge.
 *
 * Distinct from {@link pendingApproval}, and the distinction decides which remedy the gate names.
 * A check waiting on approval can be approved. A check GitHub abandoned cannot: measured on PR #407,
 * `Secret Scan` failed in 5s while its `TruffleHog` check run stayed `queued` with a null conclusion
 * on a run already marked `completed` — `rerun` refused it, the workflow has no `workflow_dispatch`,
 * and `cancel` refuses a completed run. Nothing on that SHA could move it; only a new commit could.
 *
 * Reported only when the merge is already blocked. On a mergeable pull request an unconcluded check
 * is a check still running, which is ordinary progress and not a thing to alarm anyone about.
 */
function neverConcluded(payload) {
  const runs = Array.isArray(payload?.check_runs) ? payload.check_runs : [];
  return runs
    .filter((run) => run?.conclusion == null)
    .map((run) => String(run.name ?? "(unnamed)"))
    .sort();
}

export function pendingApproval(payload) {
  const runs = Array.isArray(payload?.check_runs) ? payload.check_runs : [];
  return runs
    .filter((run) => run?.conclusion === "action_required")
    .map((run) => String(run.name ?? "(unnamed)"))
    .sort();
}

/**
 * GitHub's own verdict on whether the version pull request can merge.
 *
 * `UNKNOWN` when there is no such pull request either — which is honest: with no pull request there
 * is nothing that can merge, and the bounded wait below turns a genuinely-not-yet-created one into
 * a report rather than a false pass.
 */
/**
 * The `OWNER/REPO` this gate asks about, from CI's own variable or from the git remote.
 *
 * #405's second defect: `--repo` was passed from `String(process.env.GITHUB_REPOSITORY)`, so
 * outside CI the gate ran `gh pr list --repo undefined` and died inside `execFileSync` with a Node
 * stack trace. The comment on that call claimed passing `--repo` made the gate runnable outside CI;
 * it did not, and nothing checked.
 *
 * That matters beyond tidiness. This gate exists to make a stuck release legible, and a gate nobody
 * can run by hand is a gate nobody can verify — which is the reason the issue gives for its FIRST
 * defect surviving as long as it did. A tool that cannot be exercised locally is only ever tested
 * by the incident it was built to prevent.
 *
 * `gh` cannot infer the repository here on its own: this remote is an SSH host alias
 * (`github-usetheo:usetheokit/theokit-sdk.git`) rather than a hostname it recognises, and it exits
 * with "none of the git remotes point to a known GitHub host". The alias form and the canonical
 * `git@github.com:owner/repo.git` share a shape — everything after the last `:` — so one branch
 * reads both; HTTPS has no colon-path and takes the last two segments.
 *
 * The environment variable WINS when set, so CI keeps deciding for itself and the fallback is only
 * a fallback. An empty value is treated as unset: `--repo ''` fails as obscurely as `--repo
 * undefined`.
 *
 * @param env - the environment to read, injected so the fallback path is testable
 * @param readRemote - returns the origin remote URL; throws when there is none
 * @returns `OWNER/REPO`
 */
export function resolveRepository(env = process.env, readRemote = originRemoteUrl) {
  const declared = env.GITHUB_REPOSITORY;
  if (typeof declared === "string" && declared.length > 0) return declared;

  let remote;
  try {
    remote = readRemote();
  } catch {
    remote = "";
  }

  const slug = repositorySlug(remote);
  if (slug !== undefined) return slug;

  throw new Error(
    [
      "Cannot determine which repository to ask about.",
      "",
      `  GITHUB_REPOSITORY is unset and the origin remote (${remote === "" ? "none" : remote}) does not`,
      "  carry an OWNER/REPO. Set it explicitly:",
      "",
      "    GITHUB_REPOSITORY=owner/repo node tools/verify-release-reachable.mjs",
      "",
      "  Reported here rather than passed on, because `gh --repo undefined` fails as a stack trace",
      "  from inside this tool and reads as the gate being broken (usetheokit/theokit-sdk#405).",
    ].join("\n"),
  );
}

/** `OWNER/REPO` from a remote URL, or `undefined` when it carries none. */
function repositorySlug(remote) {
  const trimmed = remote.trim().replace(/\.git$/u, "");
  if (trimmed === "") return undefined;

  // `github-alias:owner/repo` and `git@github.com:owner/repo` — everything after the last colon.
  const afterColon = trimmed.slice(trimmed.lastIndexOf(":") + 1);
  const source = trimmed.includes("://") ? trimmed : afterColon;

  const segments = source.split("/").filter((s) => s.length > 0);
  if (segments.length < 2) return undefined;
  return segments.slice(-2).join("/");
}

/** The origin remote URL, read from git. Separated so `resolveRepository` is testable. */
function originRemoteUrl() {
  return execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
}

function mergeStateFor(branch) {
  const out = execFileSync(
    "gh",
    // `--repo` explicitly: `gh` infers the repository from the git remote, and a remote written as
    // an SSH host alias is not a host `gh` recognises — it exits with "none of the git remotes
    // point to a known GitHub host" rather than answering. The value comes from
    // `resolveRepository`, which is what actually makes the gate runnable outside CI — passing
    // `--repo` alone did not, and the comment here used to say it did (#405).
    [
      "pr",
      "list",
      "--repo",
      resolveRepository(),
      "--head",
      branch,
      "--state",
      "open",
      "--json",
      "mergeStateStatus",
      "--limit",
      "1",
    ],
    { encoding: "utf8" },
  );
  const prs = JSON.parse(out);
  return prs[0]?.mergeStateStatus ?? "UNKNOWN";
}

function checkRunsFor(ref) {
  const out = execFileSync(
    "gh",
    ["api", `repos/${resolveRepository()}/commits/${ref}/check-runs`, "--paginate"],
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
    const fixture = JSON.parse(readFileSync(process.argv[jsonFlag + 1], "utf8"));
    return report(mergeVerdict(fixture.mergeStateStatus ?? "UNKNOWN", fixture));
  }

  // Nothing pending, nothing to reach. A release that publishes nothing because there was nothing
  // to publish is a successful no-op, and failing it would train a maintainer to read this gate's
  // red as noise — which is the one outcome it cannot afford.
  let changesetDir = [];
  try {
    changesetDir = readdirSync(join(ROOT, ".changeset"));
  } catch {
    // No `.changeset/` at all: also nothing to release, and reporting a missing directory as a
    // stuck release would be the same mistake in a different shape.
  }
  if (!hasPendingChangesets(changesetDir)) {
    console.log(
      "[release-reachable] PASS — no changesets pending, so no version pull request was due.",
    );
    return 0;
  }

  // Wait for GitHub to decide before judging. Concluding while mergeability is still `UNKNOWN` is
  // what let a blocked release report green; a bounded wait is what separates "not yet" from "never".
  const deadline = Date.now() + APPEAR_TIMEOUT_MS;
  const look = () => mergeVerdict(mergeStateFor(VERSION_BRANCH), checkRunsFor(VERSION_BRANCH));
  let verdict = look();
  while (verdict.state === "absent" && Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    verdict = look();
  }
  return report(verdict);
}

function report(verdict) {
  if (verdict.state === "ok") {
    console.log(
      `[release-reachable] PASS — GitHub reports the ${VERSION_BRANCH} pull request can be merged.`,
    );
    return 0;
  }

  if (verdict.state === "absent") {
    console.error(
      `[release-reachable] ✗ GitHub never decided whether the ${VERSION_BRANCH} pull request can` +
        ` merge. Either no such pull request exists, or mergeability is still being computed.`,
    );
  } else if (verdict.blocked.length > 0) {
    console.error(
      `[release-reachable] ✗ the ${VERSION_BRANCH} pull request cannot be merged, and` +
        ` ${verdict.blocked.length} check(s) are waiting on manual approval:`,
    );
    for (const name of verdict.blocked) console.error(`      ${name}`);
    console.error("");
    console.error("  To ship THIS release, approve the pending runs:");
    console.error("    gh api -X POST repos/$GITHUB_REPOSITORY/actions/runs/<id>/approve");
  } else if (verdict.stalled.length > 0) {
    console.error(
      `[release-reachable] ✗ the ${VERSION_BRANCH} pull request cannot be merged, and` +
        ` ${verdict.stalled.length} check(s) were created but never concluded:`,
    );
    for (const name of verdict.stalled) console.error(`      ${name}`);
    console.error("");
    console.error(
      "  These exist, so they cannot be created by reopening the pull request, and they",
    );
    console.error(
      "  are not waiting on approval, so approving nothing helps. GitHub abandoned the",
    );
    console.error("  job; `rerun` refuses it and `cancel` refuses an already-completed run.");
    console.error("");
    console.error("  A NEW COMMIT is what produces a fresh check. Land one through the normal");
    console.error("  branch flow — never --admin, which publishes with a required check unrun.");
  } else {
    console.error(
      `[release-reachable] ✗ the ${VERSION_BRANCH} pull request cannot be merged, and NO check is` +
        ` waiting on approval or running — the required contexts were never created at all.`,
    );
    console.error("");
    console.error("  A pull request authored with GITHUB_TOKEN triggers no workflow, by GitHub's");
    console.error("  own rule, so its required checks do not exist to be approved.");
    console.error("");
    console.error("  To ship THIS release, make the checks run by reopening the pull request:");
    console.error("    gh pr close <n> && gh pr reopen <n>");
    console.error("  A reopen from a user account is a triggering event; --admin is not a fix, it");
    console.error("  publishes with none of the required checks having run.");
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
