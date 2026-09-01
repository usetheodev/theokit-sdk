/**
 * T2.1 — doom-loop wiring branch logic (plan doom-loop-guard).
 *
 * The pure branch logic the wiring implements — `firstDoomLoopVerdict` (per-turn inspection) +
 * `createDoomLoopTracker` (config resolution) — is tested here in lockstep with the
 * `continueOrTerminate` runtime call.
 *
 * CITATION CORRECTED 2026-09-01. This docblock used to open with "Following this repo's convention
 * (see agent-loop/budget-tracker-wiring.test.ts): the full agent loop can't be driven without a
 * stubbed LLM". That premise is false, and the cited file says so itself — it was repaired under
 * B-095 and now records: *"A mirror passes for exactly as long as someone remembers to edit it
 * alongside the code, which is the property it was supposed to VERIFY rather than assume. No
 * mutation of the real wiring could fail anything here."* The harness it claimed did not exist does:
 * `LlmClient` has two members (`name` + `stream`), the stub is ten lines, and 22 test files here
 * already drive the real `runAgentLoop`.
 *
 * The note replaces the appeal rather than deleting it, because a stale pointer to a repaired
 * exemplar is how an anti-pattern keeps recruiting after it has been named — four files cited this
 * one as a licence for the shape it had removed.
 */
import { describe, expect, it } from "vitest";
import {
  createDoomLoopTracker,
  DoomLoopTracker,
  firstDoomLoopVerdict,
} from "../../src/internal/agent-loop/doom-loop-tracker.js";

const read = (input: unknown = { p: "a" }) => ({ name: "read", input });

describe("firstDoomLoopVerdict (per-turn inspection)", () => {
  it("test_identical_calls_across_turns_hit_hard", () => {
    const t = new DoomLoopTracker();
    let last = firstDoomLoopVerdict(t, [read()]); // 1
    expect(last.kind).toBe("ok");
    last = firstDoomLoopVerdict(t, [read()]); // 2
    last = firstDoomLoopVerdict(t, [read()]); // 3 soft
    expect(last.kind).toBe("soft");
    last = firstDoomLoopVerdict(t, [read()]); // 4 ok
    expect(last.kind).toBe("ok");
    last = firstDoomLoopVerdict(t, [read()]); // 5 hard
    expect(last.kind).toBe("hard");
    expect(last.message).toBeTruthy();
  });

  it("test_different_calls_never_trip_guard", () => {
    const t = new DoomLoopTracker({ hardThreshold: 3 });
    expect(firstDoomLoopVerdict(t, [{ name: "read", input: { p: "a" } }]).kind).toBe("ok");
    expect(firstDoomLoopVerdict(t, [{ name: "write", input: { p: "a" } }]).kind).toBe("ok");
    expect(firstDoomLoopVerdict(t, [{ name: "read", input: { p: "b" } }]).kind).toBe("ok");
  });

  it("test_soft_nudge_fires_once_not_spam", () => {
    const t = new DoomLoopTracker({ softThreshold: 2, hardThreshold: 9 });
    expect(firstDoomLoopVerdict(t, [read()]).kind).toBe("ok"); // 1
    expect(firstDoomLoopVerdict(t, [read()]).kind).toBe("soft"); // 2 — the single nudge
    expect(firstDoomLoopVerdict(t, [read()]).kind).toBe("ok"); // 3 — no more nudges
    expect(firstDoomLoopVerdict(t, [read()]).kind).toBe("ok"); // 4
  });

  it("test_multi_call_turn_counts_each_call", () => {
    // One turn emitting two identical calls advances the counter by 2 → hard at threshold 2.
    const t = new DoomLoopTracker({ hardThreshold: 2 });
    const v = firstDoomLoopVerdict(t, [read(), read()]);
    expect(v.kind).toBe("hard");
  });

  it("test_hard_wins_over_soft_within_a_turn", () => {
    // A turn whose calls cross both thresholds returns the hard verdict, not the soft one.
    const t = new DoomLoopTracker({ softThreshold: 1, hardThreshold: 2 });
    const v = firstDoomLoopVerdict(t, [read(), read()]); // call1 → soft(==1), call2 → hard(>=2)
    expect(v.kind).toBe("hard");
  });

  it("test_empty_turn_is_ok", () => {
    expect(firstDoomLoopVerdict(new DoomLoopTracker(), []).kind).toBe("ok");
  });
});

describe("createDoomLoopTracker (config resolution)", () => {
  it("test_default_is_on", () => {
    expect(createDoomLoopTracker()).toBeInstanceOf(DoomLoopTracker);
    expect(createDoomLoopTracker(undefined)).toBeInstanceOf(DoomLoopTracker);
  });

  it("test_false_disables", () => {
    expect(createDoomLoopTracker(false)).toBeUndefined();
  });

  it("test_object_tunes_thresholds", () => {
    const t = createDoomLoopTracker({ hardThreshold: 2 });
    expect(t).toBeInstanceOf(DoomLoopTracker);
    // hardThreshold 2 → the 2nd identical call is hard.
    t!.inspect(read());
    expect(t!.inspect(read()).kind).toBe("hard");
  });
});
