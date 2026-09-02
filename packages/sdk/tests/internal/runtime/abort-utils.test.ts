/**
 * Tests for `anySignal` ponyfill (Production-Readiness EC-5, ADR D324).
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  abortReasonAsError,
  anySignal,
  isAborted,
} from "../../../src/internal/concurrency/abort-utils.js";

describe("anySignal — native path", () => {
  // B-126: was `if (typeof AbortSignal.any !== "function") return;` inside the body, so a legacy
  // runtime reported PASS having asserted nothing about the native path. Gated at collection time,
  // it reports SKIPPED and the count is visible.
  it.skipIf(typeof AbortSignal.any !== "function")("uses AbortSignal.any when available", () => {
    const c1 = new AbortController();
    const c2 = new AbortController();
    const composed = anySignal([c1.signal, c2.signal]);
    expect(composed.aborted).toBe(false);
    c1.abort("from c1");
    expect(composed.aborted).toBe(true);
  });
});

describe("anySignal — ponyfill path (forced)", () => {
  const originalAny = AbortSignal.any;

  afterEach(() => {
    if (originalAny !== undefined) {
      (AbortSignal as { any: typeof AbortSignal.any }).any = originalAny;
    }
  });

  it("works without native AbortSignal.any", () => {
    // Force the ponyfill branch.
    (AbortSignal as Partial<typeof AbortSignal>).any = undefined;
    const c1 = new AbortController();
    const c2 = new AbortController();
    const composed = anySignal([c1.signal, c2.signal]);
    expect(composed.aborted).toBe(false);
    c1.abort();
    expect(composed.aborted).toBe(true);
  });

  it("propagates abort reason via ponyfill", () => {
    (AbortSignal as Partial<typeof AbortSignal>).any = undefined;
    const c1 = new AbortController();
    const c2 = new AbortController();
    const composed = anySignal([c1.signal, c2.signal]);
    c2.abort("custom reason");
    expect(composed.reason).toBe("custom reason");
  });

  it("returns immediately-aborted signal when input is pre-aborted (ponyfill)", () => {
    (AbortSignal as Partial<typeof AbortSignal>).any = undefined;
    const ctrl = new AbortController();
    ctrl.abort("pre-aborted");
    const composed = anySignal([ctrl.signal]);
    expect(composed.aborted).toBe(true);
  });
});

describe("anySignal — edge cases", () => {
  it("undefined signals filtered out", () => {
    const ctrl = new AbortController();
    const composed = anySignal([undefined, ctrl.signal, undefined]);
    expect(composed.aborted).toBe(false);
    ctrl.abort();
    expect(composed.aborted).toBe(true);
  });

  it("empty array returns a never-aborting signal", () => {
    const composed = anySignal([]);
    expect(composed.aborted).toBe(false);
  });

  it("single-signal short circuit returns the signal directly", () => {
    const ctrl = new AbortController();
    const composed = anySignal([ctrl.signal]);
    expect(composed).toBe(ctrl.signal);
  });
});

describe("isAborted helper", () => {
  it("returns true for aborted signal", () => {
    const ctrl = new AbortController();
    ctrl.abort();
    expect(isAborted(ctrl.signal)).toBe(true);
  });

  it("returns false for non-aborted signal", () => {
    expect(isAborted(new AbortController().signal)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isAborted(undefined)).toBe(false);
  });
});

describe("abortReasonAsError", () => {
  it("returns the Error if reason is already an Error", () => {
    const ctrl = new AbortController();
    const myError = new Error("custom");
    ctrl.abort(myError);
    expect(abortReasonAsError(ctrl.signal)).toBe(myError);
  });

  it("wraps non-Error reasons into a generic Error", () => {
    const ctrl = new AbortController();
    ctrl.abort("string reason");
    const wrapped = abortReasonAsError(ctrl.signal);
    expect(wrapped).toBeInstanceOf(Error);
    expect(wrapped.message).toBe("string reason");
  });

  it("provides a fallback message when reason is undefined or default DOMException", () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const wrapped = abortReasonAsError(ctrl.signal);
    expect(wrapped).toBeInstanceOf(Error);
    // Node 22 sets signal.reason to a DOMException (already an Error). We
    // accept either that, the SDK fallback message, or any non-empty message.
    expect(wrapped.message.length).toBeGreaterThan(0);
  });
});
