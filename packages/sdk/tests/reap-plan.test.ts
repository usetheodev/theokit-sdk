/**
 * Deciding which session artifacts may be deleted — B-106, and the most dangerous thing in this
 * package, because the failure mode is a user's transcript that no longer exists.
 *
 * The framework creates session artifacts — transcripts, locks, temp files — and reaps only what is
 * in flight in the operation doing the reaping: a lock it just released, a `.tmp` from a failed
 * atomic write. Nothing collects the rest, so every consumer either writes its own collector or
 * lets the directory grow forever.
 *
 * ## Why this is a planner and not a deleter
 *
 * A function that decides AND deletes cannot be tested without a filesystem, and the case that
 * matters most — "we could not determine whether this session is live" — is precisely the one a
 * test would have to simulate rather than assert. Splitting them makes the decision pure: the plan
 * is the dry run, and executing it is a separate, explicit act on a value someone can read first.
 *
 * ## The tri-state, which is the whole point
 *
 * `keep`, `reap`, and `undetermined`. An artifact whose liveness could not be established is NEVER
 * reaped and never silently counted as dead. Collapsing "could not determine" into "not there" is
 * how a collector deletes a session that was running on another machine, or behind an NFS mount
 * that answered slowly. The third state costs a branch and buys the one guarantee worth having.
 */

import { describe, expect, it } from "vitest";

import { planReaping, type ReapableArtifact } from "../src/reap-plan.js";

const DAY = 86_400_000;
const NOW = 1_000 * DAY;

const art = (id: string, ageDays: number, live: boolean | "unknown" = false): ReapableArtifact => ({
  id,
  lastModifiedMs: NOW - ageDays * DAY,
  live,
});

const RETENTION = { maxAgeMs: 30 * DAY, keepLast: 2 };

describe("planReaping — age decides, within limits", () => {
  it("test_an_artifact_older_than_the_window_is_reaped", () => {
    const plan = planReaping({
      artifacts: [art("old", 40), art("a", 1), art("b", 2)],
      retention: RETENTION,
      nowMs: NOW,
    });

    expect(plan.reap.map((a) => a.id)).toEqual(["old"]);
  });

  it("test_an_artifact_inside_the_window_is_kept", () => {
    const plan = planReaping({ artifacts: [art("recent", 5)], retention: RETENTION, nowMs: NOW });

    expect(plan.reap).toEqual([]);
    expect(plan.keep.map((k) => k.id)).toEqual(["recent"]);
  });

  it("test_an_artifact_exactly_at_the_window_edge_is_kept", () => {
    // The boundary belongs to the safe side. Reaping at exactly the limit means a 30-day retention
    // sometimes keeps 30 days and sometimes 29, depending on clock granularity.
    const plan = planReaping({
      artifacts: [{ id: "edge", lastModifiedMs: NOW - 30 * DAY, live: false }],
      retention: { maxAgeMs: 30 * DAY, keepLast: 0 },
      nowMs: NOW,
    });

    expect(plan.reap).toEqual([]);
  });
});

describe("planReaping — keep-last outranks age", () => {
  it("test_the_most_recent_n_survive_however_old_they_are", () => {
    // A user who has not opened the tool in a year must still find their last sessions. Age alone
    // would empty the directory on the first run after a long break.
    const plan = planReaping({
      artifacts: [art("y1", 400), art("y2", 500), art("y3", 600)],
      retention: { maxAgeMs: 30 * DAY, keepLast: 2 },
      nowMs: NOW,
    });

    expect(plan.reap.map((a) => a.id)).toEqual(["y3"]);
    expect(plan.keep.map((k) => k.id).sort()).toEqual(["y1", "y2"]);
  });

  it("test_keep_last_counts_the_newest_not_the_first_in_the_list", () => {
    // Anti-vacuity: taking the first two of an unsorted list would pass the case above by accident.
    const plan = planReaping({
      artifacts: [art("oldest", 600), art("newest", 100), art("middle", 300)],
      retention: { maxAgeMs: 30 * DAY, keepLast: 1 },
      nowMs: NOW,
    });

    expect(plan.keep.map((k) => k.id)).toEqual(["newest"]);
  });

  it("test_keep_last_of_zero_keeps_nothing_on_age_alone", () => {
    const plan = planReaping({
      artifacts: [art("a", 400)],
      retention: { maxAgeMs: 30 * DAY, keepLast: 0 },
      nowMs: NOW,
    });

    expect(plan.reap.map((a) => a.id)).toEqual(["a"]);
  });
});

describe("planReaping — a live session is never reaped", () => {
  it("test_an_artifact_whose_writer_holds_a_lease_is_kept_however_old", () => {
    // A long-running session that has not written for weeks is still running. Deleting its
    // transcript underneath it loses everything it has not flushed.
    const plan = planReaping({
      artifacts: [art("running", 400, true)],
      retention: RETENTION,
      nowMs: NOW,
    });

    expect(plan.reap).toEqual([]);
    expect(plan.keep[0]?.reason).toBe("live");
  });

  it("test_liveness_outranks_both_age_and_keep_last", () => {
    const plan = planReaping({
      artifacts: [art("running", 400, true), art("a", 1), art("b", 2)],
      retention: { maxAgeMs: 30 * DAY, keepLast: 2 },
      nowMs: NOW,
    });

    expect(plan.reap).toEqual([]);
  });
});

describe("planReaping — could not determine is its own answer", () => {
  it("test_an_artifact_of_unknown_liveness_is_never_reaped", () => {
    // The guarantee this exists for. A lock file behind a slow mount, a PID on another machine — the
    // honest answer is "do not know", and the only safe action on it is none.
    const plan = planReaping({
      artifacts: [art("maybe", 400, "unknown")],
      retention: RETENTION,
      nowMs: NOW,
    });

    expect(plan.reap).toEqual([]);
  });

  it("test_it_is_reported_as_undetermined_rather_than_as_kept", () => {
    // Collapsing it into `keep` would make the report say the collector decided when it did not,
    // and an operator reading "kept: 12" would have no reason to look further.
    const plan = planReaping({
      artifacts: [art("maybe", 400, "unknown")],
      retention: RETENTION,
      nowMs: NOW,
    });

    expect(plan.undetermined.map((a) => a.id)).toEqual(["maybe"]);
    expect(plan.keep).toEqual([]);
  });

  it("test_an_undetermined_artifact_does_not_consume_a_keep_last_slot", () => {
    // It was never a decision, so it must not push a decidable artifact over the edge. Otherwise a
    // transient mount failure silently shrinks how much history survives.
    const plan = planReaping({
      artifacts: [art("maybe", 100, "unknown"), art("a", 200), art("b", 300)],
      retention: { maxAgeMs: 30 * DAY, keepLast: 2 },
      nowMs: NOW,
    });

    expect(plan.reap).toEqual([]);
    expect(plan.keep.map((k) => k.id).sort()).toEqual(["a", "b"]);
  });
});

describe("planReaping — the plan says why", () => {
  it("test_every_kept_artifact_carries_the_reason_it_survived", () => {
    // `keepLast: 3` with only two survivors from other reasons, so the floor actually rescues one —
    // which is the only way a `keep-last` reason can occur. Written this way after the first version
    // of this case and `test_an_artifact_older_than_the_window_is_reaped` turned out to encode two
    // DIFFERENT readings of `keepLast`: a floor on total survivors, and a bonus on top of the
    // window. Only the implementation forced the choice. The floor is the standard reading and the
    // one explainable in a sentence — "you will always have your last N sessions".
    const plan = planReaping({
      artifacts: [art("live", 400, true), art("young", 1), art("rescued", 400), art("gone", 500)],
      retention: { maxAgeMs: 30 * DAY, keepLast: 3 },
      nowMs: NOW,
    });

    const reasonOf = (id: string) => plan.keep.find((k) => k.id === id)?.reason;
    expect(reasonOf("live")).toBe("live");
    expect(reasonOf("young")).toBe("within-retention");
    expect(reasonOf("rescued")).toBe("keep-last");
    expect(plan.reap.map((a) => a.id)).toEqual(["gone"]);
  });

  it("test_the_floor_rescues_nothing_when_the_window_already_spared_enough", () => {
    // The other half of the same decision, and the anti-vacuity for it: if `keepLast` were a bonus
    // rather than a floor, `old` would survive here too and the promise would silently mean "your
    // last N PLUS everything recent".
    const plan = planReaping({
      artifacts: [art("a", 1), art("b", 2), art("old", 400)],
      retention: { maxAgeMs: 30 * DAY, keepLast: 2 },
      nowMs: NOW,
    });

    expect(plan.reap.map((a) => a.id)).toEqual(["old"]);
  });

  it("test_nothing_appears_in_more_than_one_bucket", () => {
    // The invariant an operator reads the totals against: reaped + kept + undetermined is the whole
    // input, counted once. A double-counted artifact makes "12 of 40" mean nothing.
    const artifacts = [art("a", 1), art("b", 400), art("c", 400, true), art("d", 400, "unknown")];
    const plan = planReaping({ artifacts, retention: RETENTION, nowMs: NOW });

    const seen = [...plan.reap, ...plan.keep, ...plan.undetermined].map((a) => a.id);
    expect(seen.sort()).toEqual(["a", "b", "c", "d"]);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("test_an_empty_directory_plans_nothing_rather_than_throwing", () => {
    expect(planReaping({ artifacts: [], retention: RETENTION, nowMs: NOW })).toEqual({
      reap: [],
      keep: [],
      undetermined: [],
    });
  });
});

describe("planReaping — the retention window must be declared, not guessed", () => {
  it("test_a_negative_retention_window_is_refused", () => {
    // A negative window would make everything older than the future — i.e. everything — reapable.
    // On the path that deletes user data, a nonsense input fails loudly rather than being clamped.
    expect(() =>
      planReaping({
        artifacts: [art("a", 1)],
        retention: { maxAgeMs: -1, keepLast: 1 },
        nowMs: NOW,
      }),
    ).toThrow(/maxAgeMs/);
  });

  it("test_a_negative_keep_last_is_refused", () => {
    expect(() =>
      planReaping({
        artifacts: [art("a", 1)],
        retention: { maxAgeMs: DAY, keepLast: -1 },
        nowMs: NOW,
      }),
    ).toThrow(/keepLast/);
  });
});
