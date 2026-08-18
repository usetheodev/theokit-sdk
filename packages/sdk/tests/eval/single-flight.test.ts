/**
 * D213 — single-flight guard for Eval.run.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  __resetSingleFlightForTests,
  acquireSingleFlight,
  EvalAlreadyRunningError,
  releaseSingleFlight,
} from "../../src/internal/eval/single-flight.js";

beforeEach(() => __resetSingleFlightForTests());
afterEach(() => __resetSingleFlightForTests());

describe("single-flight (D213)", () => {
  it("acquire / release cycle is idempotent on release", () => {
    // B-004. The body was five bare calls with the claims in trailing comments. It was not
    // unprotected — a no-op `releaseSingleFlight` makes the re-acquire throw, so this test does
    // fail today — but the oracle was the accident of a later line throwing, not something the test
    // states. Reorder the calls and the protection disappears silently. Both claims are now
    // assertions, and the second one is new: that re-acquire actually TOOK the slot rather than
    // being ignored.
    acquireSingleFlight("a");
    releaseSingleFlight("a");

    expect(() => releaseSingleFlight("a"), "a second release must be a no-op").not.toThrow();
    expect(
      () => acquireSingleFlight("a"),
      "after release the slot must be free again",
    ).not.toThrow();
    expect(
      () => acquireSingleFlight("a"),
      "and the re-acquire must have taken the slot, not been ignored",
    ).toThrow(EvalAlreadyRunningError);

    releaseSingleFlight("a");
  });

  it("acquire twice with same name throws EvalAlreadyRunningError", () => {
    acquireSingleFlight("dup");
    expect(() => acquireSingleFlight("dup")).toThrow(EvalAlreadyRunningError);
    releaseSingleFlight("dup");
  });

  it("EvalAlreadyRunningError exposes evalName", () => {
    acquireSingleFlight("named");
    try {
      acquireSingleFlight("named");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(EvalAlreadyRunningError);
      expect((err as EvalAlreadyRunningError).evalName).toBe("named");
    }
    releaseSingleFlight("named");
  });

  it("different names race freely", () => {
    acquireSingleFlight("a");
    acquireSingleFlight("b");
    acquireSingleFlight("c");
    releaseSingleFlight("a");
    releaseSingleFlight("b");
    releaseSingleFlight("c");
  });
});
