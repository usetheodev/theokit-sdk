import { describe, expect, it } from "vitest";
import { checkVerdict, pendingApproval, VERSION_BRANCH } from "../verify-release-reachable.mjs";

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
  it("reports that no check exists yet, distinctly from a healthy pull request", () => {
    // Measured on run 32918852952: the gate ran at ~01:24 and the four check runs were created at
    // 01:35, so it saw an empty payload and passed on a pull request that was BLOCKED. An empty
    // payload is "too early to tell", never "all clear" — the two must not collapse.
    expect(checkVerdict({ check_runs: [] })).toEqual({ state: "absent", blocked: [] });
    expect(checkVerdict({})).toEqual({ state: "absent", blocked: [] });
  });

  it("reports blocked once a check is waiting on a human", () => {
    expect(
      checkVerdict({ check_runs: [run("CI", "action_required"), run("CodeQL", "success")] }),
    ).toEqual({ state: "blocked", blocked: ["CI"] });
  });

  it("reports ok once checks exist and none is waiting", () => {
    // The accepted case (`testing.md` § 4.2): a verdict that never said "ok" would fail every
    // release, and a gate that fails every time is one people learn to ignore.
    expect(
      checkVerdict({ check_runs: [run("CI", "success"), run("CodeQL", null, "in_progress")] }),
    ).toEqual({ state: "ok", blocked: [] });
  });
});
