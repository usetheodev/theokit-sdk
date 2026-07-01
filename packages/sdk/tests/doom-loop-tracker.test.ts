/**
 * T1.1 — pure `DoomLoopTracker` (plan doom-loop-guard, blueprint SHIPPABLE_WITH_CAVEATS 89.0).
 *
 * Detects consecutive IDENTICAL tool calls (same name + same canonical input) and escalates
 * ok → soft (nudge, once) → hard (stop). Pure state machine, dependency-free, never throws.
 * RED set mirrors a peer LoopDetectionTracker
 * (.claude/knowledge-base/references/a peer/.../safety/loop-detection.ts).
 */
import { describe, expect, it } from "vitest";
import { DoomLoopTracker, signatureOf } from "../src/internal/agent-loop/doom-loop-tracker.js";

describe("signatureOf", () => {
  it("test_signature_is_canonical_key_order_insensitive", () => {
    expect(signatureOf({ name: "t", input: { a: 1, b: 2 } })).toBe(
      signatureOf({ name: "t", input: { b: 2, a: 1 } }),
    );
  });

  it("test_signature_distinguishes_name", () => {
    expect(signatureOf({ name: "a", input: { x: 1 } })).not.toBe(
      signatureOf({ name: "b", input: { x: 1 } }),
    );
  });

  it("test_signature_distinguishes_input", () => {
    expect(signatureOf({ name: "t", input: { x: 1 } })).not.toBe(
      signatureOf({ name: "t", input: { x: 2 } }),
    );
  });

  it("test_signature_handles_null_and_primitive_input", () => {
    expect(() => signatureOf({ name: "t", input: null })).not.toThrow();
    expect(() => signatureOf({ name: "t", input: "s" })).not.toThrow();
    expect(() => signatureOf({ name: "t", input: 5 })).not.toThrow();
  });

  it("test_signature_treats_undefined_valued_key_as_absent (EC-3)", () => {
    // JSON.stringify drops undefined — an undefined arg is not a distinguishing input.
    expect(signatureOf({ name: "t", input: { a: 1, b: undefined } })).toBe(
      signatureOf({ name: "t", input: { a: 1 } }),
    );
  });

  it("test_never_throws_on_weird_input", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => signatureOf({ name: "t", input: circular })).not.toThrow();
    expect(() => signatureOf({ name: "t", input: { s: Symbol("x") } })).not.toThrow();
  });
});

describe("DoomLoopTracker", () => {
  const call = (input: unknown = { p: "a" }) => ({ name: "read", input });

  it("test_default_thresholds_are_3_and_5", () => {
    const t = new DoomLoopTracker();
    expect(t.inspect(call()).kind).toBe("ok"); // 1
    expect(t.inspect(call()).kind).toBe("ok"); // 2
    expect(t.inspect(call()).kind).toBe("soft"); // 3 == softThreshold
    expect(t.inspect(call()).kind).toBe("ok"); // 4 (strictly between)
    expect(t.inspect(call()).kind).toBe("hard"); // 5 >= hardThreshold
  });

  it("test_inspect_ok_below_soft", () => {
    const t = new DoomLoopTracker();
    expect(t.inspect(call()).kind).toBe("ok");
    expect(t.inspect(call()).kind).toBe("ok");
  });

  it("test_inspect_soft_at_threshold", () => {
    const t = new DoomLoopTracker();
    t.inspect(call());
    t.inspect(call());
    const v = t.inspect(call());
    expect(v.kind).toBe("soft");
    expect(v.message).toBeTruthy();
  });

  it("test_inspect_ok_strictly_between_soft_and_hard (EC-1)", () => {
    const t = new DoomLoopTracker();
    t.inspect(call()); // 1
    t.inspect(call()); // 2
    t.inspect(call()); // 3 soft
    expect(t.inspect(call()).kind).toBe("ok"); // 4 — soft fires ONLY at ==softThreshold
  });

  it("test_inspect_hard_at_threshold", () => {
    const t = new DoomLoopTracker();
    for (let i = 0; i < 4; i++) t.inspect(call());
    const v = t.inspect(call()); // 5
    expect(v.kind).toBe("hard");
    expect(v.message).toBeTruthy();
  });

  it("test_hard_message_names_the_tool_and_count", () => {
    const t = new DoomLoopTracker({ hardThreshold: 2 });
    t.inspect(call());
    const v = t.inspect(call());
    expect(v.message).toContain("read");
    expect(v.message).toContain("2");
  });

  it("test_counter_resets_on_different_call", () => {
    const t = new DoomLoopTracker({ hardThreshold: 2 });
    t.inspect({ name: "read", input: { p: "a" } });
    expect(t.inspect({ name: "write", input: { p: "a" } }).kind).toBe("ok"); // different name resets
  });

  it("test_counter_resets_on_different_input", () => {
    const t = new DoomLoopTracker({ hardThreshold: 2 });
    t.inspect(call({ p: "a" }));
    expect(t.inspect(call({ p: "b" })).kind).toBe("ok"); // different input resets
  });

  it("test_reset_clears_state", () => {
    const t = new DoomLoopTracker({ hardThreshold: 2 });
    t.inspect(call());
    t.reset();
    expect(t.inspect(call()).kind).toBe("ok"); // count restarts at 1 after reset
  });

  it("test_custom_thresholds", () => {
    const t = new DoomLoopTracker({ softThreshold: 2, hardThreshold: 3 });
    expect(t.inspect(call()).kind).toBe("ok"); // 1
    expect(t.inspect(call()).kind).toBe("soft"); // 2
    expect(t.inspect(call()).kind).toBe("hard"); // 3
  });
});
