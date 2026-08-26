import { describe, expect, it } from "vitest";
import {
  mergeVerdict,
  pendingApproval,
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
    expect(mergeVerdict("UNKNOWN", { check_runs: [] })).toEqual({ state: "absent", blocked: [] });
  });

  it("reports blocked once a check is waiting on a human", () => {
    expect(
      mergeVerdict("BLOCKED", {
        check_runs: [run("CI", "action_required"), run("CodeQL", "success")],
      }),
    ).toEqual({ state: "blocked", blocked: ["CI"] });
  });

  it("reports ok on a pull request github says can merge", () => {
    // The accepted case (`testing.md` § 4.2): a verdict that never said "ok" would fail every
    // release, and a gate that fails every time is one people learn to ignore.
    expect(
      mergeVerdict("CLEAN", { check_runs: [run("CI", "success"), run("CodeQL", null, "in_progress")] }),
    ).toEqual({ state: "ok", blocked: [] });
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
