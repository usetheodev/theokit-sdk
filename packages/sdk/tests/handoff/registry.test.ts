/**
 * Handoff chain state (D218 max-depth + D221 pair single-flight).
 */

import { describe, expect, it } from "vitest";

import { createChainState, currentDepth, recordHop } from "../../src/internal/handoff/registry.js";
import { HandoffLoopError, HandoffPairLoopError } from "../../src/types/handoff.js";

describe("handoff chain state", () => {
  it("createChainState seeds with root agent (depth 0)", () => {
    const s = createChainState("root", 5);
    expect(s.chain).toEqual(["root"]);
    expect(currentDepth(s)).toBe(0);
  });

  it("recordHop advances depth and tracks the chain", () => {
    const s = createChainState("a", 5);
    recordHop(s, "a", "b");
    expect(currentDepth(s)).toBe(1);
    expect(s.chain).toEqual(["a", "b"]);
    recordHop(s, "b", "c");
    expect(currentDepth(s)).toBe(2);
    expect(s.chain).toEqual(["a", "b", "c"]);
  });

  it("D218 — depth > maxDepth throws HandoffLoopError", () => {
    const s = createChainState("a", 2);
    recordHop(s, "a", "b"); // depth 1, OK
    recordHop(s, "b", "c"); // depth 2 == max, OK
    expect(() => recordHop(s, "c", "d")).toThrow(HandoffLoopError);
  });

  it("HandoffLoopError exposes depth + chain", () => {
    const s = createChainState("a", 1);
    recordHop(s, "a", "b"); // depth 1
    try {
      recordHop(s, "b", "c"); // depth 2 > 1
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(HandoffLoopError);
      const e = err as HandoffLoopError;
      expect(e.depth).toBe(1);
      expect(e.chain).toEqual(["a", "b", "c"]);
    }
  });

  it("D221 — same (sender, receiver) pair twice throws HandoffPairLoopError", () => {
    const s = createChainState("a", 5);
    recordHop(s, "a", "b");
    expect(() => recordHop(s, "a", "b")).toThrow(HandoffPairLoopError);
  });

  it("D221 — different pairs (A->B, B->A) BOTH allowed (reverse is a different pair)", () => {
    const s = createChainState("a", 5);
    recordHop(s, "a", "b"); // a -> b
    expect(() => recordHop(s, "b", "a")).not.toThrow(); // b -> a is a fresh pair
  });

  it("maxDepth 0 rejects ANY handoff hop", () => {
    const s = createChainState("a", 0);
    expect(() => recordHop(s, "a", "b")).toThrow(HandoffLoopError);
  });
});
