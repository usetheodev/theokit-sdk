/**
 * G8 T1.2 — SubscriptionCtx + TrackedEnvelope + errors.
 */
import { describe, expect, it } from "vitest";
import { TheokitAgentError } from "../../src/errors.js";
import {
  isTrackedEnvelope,
  SubscriptionDisconnectError,
  SubscriptionError,
  SubscriptionInputError,
  type TrackedEnvelope,
  tracked,
} from "../../src/subscription/types.js";
import { expectPublicError } from "../helpers/assert-public-error.js";

describe("tracked() envelope", () => {
  it("returns [id, payload] tuple", () => {
    const env = tracked("ev-1", { hello: "world" });
    expect(env).toEqual(["ev-1", { hello: "world" }]);
    expect(env[0]).toBe("ev-1");
    expect(env[1]).toEqual({ hello: "world" });
  });

  it("rejects empty id", () => {
    expect(() => tracked("", { x: 1 })).toThrow(TypeError);
  });

  it("rejects non-string id", () => {
    // @ts-expect-error testing runtime guard
    expect(() => tracked(42, { x: 1 })).toThrow(TypeError);
  });
});

describe("isTrackedEnvelope", () => {
  it("returns true for valid envelope", () => {
    const env: TrackedEnvelope<{ x: number }> = ["a", { x: 1 }];
    expect(isTrackedEnvelope(env)).toBe(true);
  });

  it("returns false for non-array", () => {
    expect(isTrackedEnvelope({ id: "a", data: 1 })).toBe(false);
    expect(isTrackedEnvelope("string")).toBe(false);
    expect(isTrackedEnvelope(null)).toBe(false);
  });

  it("returns false for array of wrong length", () => {
    expect(isTrackedEnvelope([])).toBe(false);
    expect(isTrackedEnvelope(["a"])).toBe(false);
    expect(isTrackedEnvelope(["a", 1, 2])).toBe(false);
  });

  it("returns false for [non-string-id, ...]", () => {
    expect(isTrackedEnvelope([1, "x"])).toBe(false);
  });
});

describe("Subscription error hierarchy", () => {
  it("SubscriptionError extends TheokitAgentError", () => {
    const e = new SubscriptionError("boom");
    expect(e).toBeInstanceOf(TheokitAgentError);
    expect(e.name).toBe("SubscriptionError");
    expect(e.isRetryable).toBe(false);
  });

  it("SubscriptionInputError carries issues field", () => {
    const e = new SubscriptionInputError("bad input", {
      issues: { fieldErrors: { x: ["required"] } },
    });
    expectPublicError(e, {
      ctor: SubscriptionError,
      code: "subscription_input_invalid",
    });
    expect(e.issues).toEqual({ fieldErrors: { x: ["required"] } });
  });

  it("SubscriptionDisconnectError carries close code/reason", () => {
    const e = new SubscriptionDisconnectError("disconnected", {
      closeCode: 1006,
      closeReason: "abnormal",
    });
    expect(e).toBeInstanceOf(SubscriptionError);
    expect(e.name).toBe("SubscriptionDisconnectError");
    expect(e.code).toBe("subscription_disconnected");
    expect(e.closeCode).toBe(1006);
    expect(e.closeReason).toBe("abnormal");
  });
});
