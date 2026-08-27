import { describe, expect, it } from "vitest";
import {
  hasPendingChangesets,
  mergeVerdict,
  pendingApproval,
  resolveRepository,
  VERSION_BRANCH,
} from "../verify-release-reachable.mjs";

/*
 * #388 — the release pipeline reported success while publishing nothing, for eight days.
 *
 * `changesets/action` opens a "Version Packages" pull request when changesets are pending, and
 * every workflow on it landed in `action_required` — created, never run, waiting on a human that
 * nobody knew to be waiting for. `main` requires those checks, so the pull request was permanently
 * BLOCKED while the release run stayed green.
 *
 * This gate does not unblock the release; unblocking is a repository-configuration decision. It
 * makes the stuck state say so, in the run a maintainer is already looking at.
 */

const run = (name: string, conclusion: string | null, status = "completed") => ({
  name,
  status,
  conclusion,
});

it("reports every check that is waiting on manual approval", () => {
  const blocked = pendingApproval({
    check_runs: [
      run("CI", "action_required"),
      run("CodeQL", "action_required"),
      run("Secret Scan", "action_required"),
      run("Socket Security: Pull Request Alerts", "success"),
    ],
  });

  expect(blocked).toEqual(["CI", "CodeQL", "Secret Scan"]);
});

it("stays silent while checks are merely queued or running", () => {
  // The accepted case (`testing.md` § 4.2), and the reason the gate keys on `action_required`
  // rather than on "not green": a freshly-opened pull request always has checks in flight, and
  // failing on those would be a flaky gate — which `testing.md` § 6 calls a bug. `action_required`
  // is terminal without a human, so observing it once is never a race.
  const blocked = pendingApproval({
    check_runs: [run("CI", null, "in_progress"), run("CodeQL", null, "queued")],
  });

  expect(blocked).toEqual([]);
});

it("stays silent on a healthy release", () => {
  expect(pendingApproval({ check_runs: [run("CI", "success"), run("CodeQL", "success")] })).toEqual(
    [],
  );
});

it("treats a payload with no check runs as nothing to report", () => {
  // A branch that does not exist yet — the ordinary state between releases — must not fail the run.
  expect(pendingApproval({})).toEqual([]);
  expect(pendingApproval({ check_runs: [] })).toEqual([]);
  expect(pendingApproval(null)).toEqual([]);
});

it("watches the branch changesets actually opens its pull request from", () => {
  // Naming the wrong branch would make the gate pass forever while reporting that it checked.
  expect(VERSION_BRANCH).toBe("changeset-release/main");
});

describe("what the run can conclude, and when", () => {
  it("reports that mergeability is not decided yet, distinctly from a healthy pull request", () => {
    // Measured on run 32918852952: the gate ran at ~01:24 and the four check runs were created at
    // 01:35, so it saw an empty payload and passed on a pull request that was BLOCKED. "Too early
    // to tell" and "all clear" must not collapse — `UNKNOWN` is GitHub still computing the answer.
    expect(mergeVerdict("UNKNOWN", { check_runs: [] })).toEqual({ state: "absent", blocked: [], stalled: [] });
  });

  it("reports blocked once a check is waiting on a human", () => {
    expect(
      mergeVerdict("BLOCKED", {
        check_runs: [run("CI", "action_required"), run("CodeQL", "success")],
      }),
    ).toEqual({ state: "blocked", blocked: ["CI"], stalled: [] });
  });

  it("reports ok on a pull request github says can merge", () => {
    // The accepted case (`testing.md` § 4.2): a verdict that never said "ok" would fail every
    // release, and a gate that fails every time is one people learn to ignore.
    expect(
      mergeVerdict("CLEAN", { check_runs: [run("CI", "success"), run("CodeQL", null, "in_progress")] }),
    ).toEqual({ state: "ok", blocked: [], stalled: [] });
  });

  it("treats a state it does not recognise as blocking rather than as fine", () => {
    // Allowlist, not denylist: a state GitHub adds later must stop the release until a human has
    // decided what it means, never wave it through because the code had not heard of it.
    expect(mergeVerdict("SOME_FUTURE_STATE", { check_runs: [] }).state).toBe("blocked");
  });
});

/*
 * Measured on the 4.57.0 release, 2026-08-26 — the gate reported ok on a release that was blocked.
 *
 * `check_runs` on `changeset-release/main` held exactly two entries, both Socket Security, both
 * `success`. Neither is a required context on `main`. The five that ARE required — validate on two
 * node versions, TruffleHog, and the two CodeQL analyses — had not been created at all, because the
 * pull request was authored by `GITHUB_TOKEN` and GitHub emits no triggering event for it.
 *
 * So `pendingApproval` found nothing stuck (nothing was `action_required`; nothing existed), and
 * `runs.length !== 0` said "checks appeared". Both were true. The pull request was BLOCKED.
 *
 * The bug is the question, not the arithmetic: "did ANY check appear" is not "can this merge".
 * `absent` was split out of `ok` to fix the empty-payload race, and this is the same failure one
 * step over — a payload that is non-empty for irrelevant reasons.
 */
describe("mergeability is the question — #388 follow-up", () => {
  const socketOnly = {
    check_runs: [
      { name: "Socket Security: Project Report", status: "completed", conclusion: "success" },
      { name: "Socket Security: Pull Request Alerts", status: "completed", conclusion: "success" },
    ],
  };

  it("does not call a release reachable because unrelated checks happen to exist", () => {
    expect(mergeVerdict("BLOCKED", socketOnly).state).toBe("blocked");
  });

  it("reports a clean pull request as reachable", () => {
    expect(mergeVerdict("CLEAN", { check_runs: [] }).state).toBe("ok");
  });

  it("keeps waiting while github has not computed mergeability yet", () => {
    expect(mergeVerdict("UNKNOWN", { check_runs: [] }).state).toBe("absent");
  });

  it("names the checks waiting on a human when there are any, as diagnosis", () => {
    const stuck = { check_runs: [{ name: "validate", conclusion: "action_required" }] };
    expect(mergeVerdict("BLOCKED", stuck).blocked).toEqual(["validate"]);
  });

  it("reports blocked with no names when the required checks were never created", () => {
    expect(mergeVerdict("BLOCKED", socketOnly).blocked).toEqual([]);
  });

  it("does not block on a failing check that is not required to merge", () => {
    const unstable = { check_runs: [{ name: "flaky-extra", conclusion: "failure" }] };
    expect(mergeVerdict("UNSTABLE", unstable).state).toBe("ok");
  });
});

/*
 * Measured on PR #407, 2026-08-26 15:04 — a third shape the message did not have words for.
 *
 * `Secret Scan` started and failed in 5s, and its `TruffleHog` check run was left `queued` with a
 * null conclusion on a run GitHub had already marked `completed`. The check never concluded, so the
 * pull request stayed BLOCKED; `gh run rerun` refused it, `workflow_dispatch` does not exist on that
 * workflow, and `gh run cancel` refuses a completed run. Nothing on that SHA could move it.
 *
 * The gate would have reported "the required contexts were never created at all" and pointed at
 * close/reopen — both wrong here. The context WAS created, and reopening re-fires pull_request
 * events while this check came from the push event. A gate that names the wrong remedy sends the
 * operator down a path that cannot work, which is worse than naming none.
 */
describe("a required check can be created and then abandoned — #407", () => {
  const orphaned = {
    check_runs: [
      { name: "validate (node 22)", status: "completed", conclusion: "success" },
      { name: "TruffleHog", status: "queued", conclusion: null },
    ],
  };

  it("names the check that was created and never concluded", () => {
    expect(mergeVerdict("BLOCKED", orphaned).stalled).toEqual(["TruffleHog"]);
  });

  it("does not confuse an abandoned check with one waiting on approval", () => {
    expect(mergeVerdict("BLOCKED", orphaned).blocked).toEqual([]);
  });

  it("counts a check still legitimately running as stalled only once it blocks the merge", () => {
    // Same shape, different meaning: on a CLEAN pull request an in-progress check is just progress.
    expect(mergeVerdict("CLEAN", orphaned).stalled).toEqual([]);
  });

  it("reports nothing stalled when every check reached a conclusion", () => {
    expect(
      mergeVerdict("BLOCKED", {
        check_runs: [{ name: "validate", status: "completed", conclusion: "failure" }],
      }).stalled,
    ).toEqual([]);
  });
});

/*
 * #405, second defect — the gate could not run outside CI.
 *
 * The first defect (a verdict derived from "did any check appear?") is fixed. This is the other
 * half of the same issue, and the issue is explicit that the two are connected: "Any local
 * verification of this gate crashes before it measures anything — which is part of why the first
 * defect survived."
 *
 * Passing `--repo` was the right move and only half the fix. The value came from
 * `String(process.env.GITHUB_REPOSITORY)`, which outside CI is the literal string `"undefined"`, so
 * the gate ran `gh pr list --repo undefined` and died with a Node stack trace. The comment above
 * that call claimed the opposite — that passing `--repo` "makes the gate runnable outside CI too".
 *
 * This repository's remote is an SSH host alias (`github-usetheo:usetheokit/theokit-sdk.git`),
 * which is exactly what stops `gh` inferring the repository on its own, so the fallback has to read
 * the alias form and not only the two canonical ones.
 */
describe("resolveRepository — the gate runs outside CI too (#405)", () => {
  it("prefers GITHUB_REPOSITORY when CI set it", () => {
    expect(resolveRepository({ GITHUB_REPOSITORY: "owner/repo" }, () => "unused")).toBe(
      "owner/repo",
    );
  });

  it("ignores an empty GITHUB_REPOSITORY rather than passing it on", () => {
    // `--repo ''` fails as obscurely as `--repo undefined`; an unset and an empty variable mean
    // the same thing here.
    expect(
      resolveRepository({ GITHUB_REPOSITORY: "" }, () => "git@github.com:usetheokit/theokit-sdk.git"),
    ).toBe("usetheokit/theokit-sdk");
  });

  it("reads an SSH host alias, which is the shape that breaks `gh` inference", () => {
    expect(resolveRepository({}, () => "github-usetheo:usetheokit/theokit-sdk.git")).toBe(
      "usetheokit/theokit-sdk",
    );
  });

  it("reads the canonical SSH and HTTPS forms", () => {
    expect(resolveRepository({}, () => "git@github.com:usetheokit/theokit-sdk.git")).toBe(
      "usetheokit/theokit-sdk",
    );
    expect(resolveRepository({}, () => "https://github.com/usetheokit/theokit-sdk.git")).toBe(
      "usetheokit/theokit-sdk",
    );
    expect(resolveRepository({}, () => "https://github.com/usetheokit/theokit-sdk")).toBe(
      "usetheokit/theokit-sdk",
    );
  });

  it("names what to set when nothing resolves, instead of dying inside gh", () => {
    // The failure this replaces was a Node stack trace from execFileSync. An operator running the
    // gate by hand should be told which variable to set, not shown the call that broke.
    expect(() =>
      resolveRepository({}, () => {
        throw new Error("no remote");
      }),
    ).toThrow(/GITHUB_REPOSITORY/u);
  });
});

/*
 * Measured on the 4a49e7d8 release run, 2026-08-27 — the gate failed a release that had nothing to
 * release.
 *
 * `.changeset/` held only `config.json`: every changeset had been consumed by the previous version
 * PR. `changesets/action` therefore published nothing AND opened no version pull request, which is
 * a clean no-op — the log says so plainly ("No changesets found") and every package reported
 * "already published on npm".
 *
 * The workflow runs this gate when `published != 'true'`, and that condition covers two situations
 * this file had collapsed into one: a version PR exists and must be checked, or no version PR was
 * ever meant to exist. Reporting the second as "GitHub never decided whether the pull request can
 * merge" fails a green release and, worse, trains a maintainer to read this gate's red as noise —
 * which is exactly what it was built to stop.
 *
 * Detected here rather than by tightening the workflow's `if:`, so the tool is correct on its own
 * and cannot be re-broken by a condition edited somewhere else.
 */
describe("nothing to release is not a stuck release — 4a49e7d8", () => {
  it("test_a_directory_with_only_config_has_no_pending_changesets", () => {
    expect(hasPendingChangesets(["config.json"])).toBe(false);
  });

  it("test_readme_alone_is_not_a_changeset", () => {
    expect(hasPendingChangesets(["README.md", "config.json"])).toBe(false);
  });

  it("test_an_empty_directory_has_no_pending_changesets", () => {
    expect(hasPendingChangesets([])).toBe(false);
  });

  // The accepted case (rules/testing.md § 4.2): a predicate that answered `false` for everything
  // would satisfy all three above and disable the gate entirely — which is the failure this gate
  // exists to prevent, arriving through its own fix.
  it("test_a_real_changeset_file_is_pending", () => {
    expect(hasPendingChangesets(["config.json", "brave-pandas-shake.md"])).toBe(true);
  });

  it("test_one_changeset_among_the_furniture_is_enough", () => {
    expect(hasPendingChangesets(["README.md", "config.json", "zod-is-a-real-dependency.md"])).toBe(
      true,
    );
  });
});
