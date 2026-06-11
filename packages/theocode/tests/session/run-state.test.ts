import { describe, expect, it } from "vitest";
import {
  RunState,
  RunStateBusyError,
  RunStateInvalidTransitionError,
} from "../../src/session/run-state.js";

describe("RunState", () => {
  it("initial state is idle", () => {
    const rs = new RunState();
    expect(rs.state).toBe("idle");
  });

  it("transitions from idle to busy via start()", () => {
    const rs = new RunState();
    rs.start();
    expect(rs.state).toBe("busy");
  });

  it("transitions from busy to idle via complete()", () => {
    const rs = new RunState();
    rs.start();
    rs.complete();
    expect(rs.state).toBe("idle");
  });

  it("transitions from busy to error via fail()", () => {
    const rs = new RunState();
    rs.start();
    const err = new Error("something went wrong");
    rs.fail(err);
    expect(rs.state).toBe("error");
    expect(rs.error).toBe(err);
  });

  it("cancel from busy returns to idle", () => {
    const rs = new RunState();
    rs.start();
    rs.cancel();
    expect(rs.state).toBe("idle");
  });

  it("throws RunStateBusyError when start() called while busy", () => {
    const rs = new RunState();
    rs.start();
    expect(() => rs.start()).toThrow(RunStateBusyError);
  });

  it("EC-4: can restart after error (recovery)", () => {
    const rs = new RunState();
    rs.start();
    rs.fail(new Error("oops"));
    expect(rs.state).toBe("error");

    // Should be able to recover from error
    rs.start();
    expect(rs.state).toBe("busy");
    expect(rs.error).toBeUndefined();
  });

  it("throws on invalid transitions", () => {
    const rs = new RunState();

    // Cannot complete from idle
    expect(() => rs.complete()).toThrow(RunStateInvalidTransitionError);

    // Cannot fail from idle
    expect(() => rs.fail(new Error("x"))).toThrow(RunStateInvalidTransitionError);

    // Cannot cancel from idle
    expect(() => rs.cancel()).toThrow(RunStateInvalidTransitionError);
  });
});
