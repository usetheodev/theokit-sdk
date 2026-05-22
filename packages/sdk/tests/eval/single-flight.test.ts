/**
 * D213 — single-flight guard for Eval.run.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  EvalAlreadyRunningError,
  __resetSingleFlightForTests,
  acquireSingleFlight,
  releaseSingleFlight,
} from "../../src/internal/eval/single-flight.js";

beforeEach(() => __resetSingleFlightForTests());
afterEach(() => __resetSingleFlightForTests());

describe("single-flight (D213)", () => {
  it("acquire / release cycle is idempotent on release", () => {
    acquireSingleFlight("a");
    releaseSingleFlight("a");
    releaseSingleFlight("a"); // double release is fine
    acquireSingleFlight("a"); // can acquire again
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
