/**
 * T1.1 — pure `DoomLoopTracker` (plan doom-loop-guard, blueprint SHIPPABLE_WITH_CAVEATS 89.0).
 *
 * Detects consecutive IDENTICAL tool calls (same name + same canonical input) and escalates
 * ok → soft (nudge, once) → hard (stop). Pure state machine, dependency-free, never throws.
 * RED set mirrors a peer LoopDetectionTracker
 * (.claude/knowledge-base/references/a peer/.../safety/loop-detection.ts).
 */
import { describe, expect, it } from "vitest";
import { ConfigurationError } from "../src/errors.js";
import {
  createDoomLoopTracker,
  DoomLoopTracker,
  signatureOf,
} from "../src/internal/agent-loop/doom-loop-tracker.js";

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

  it("test_signature_delimiter_is_collision_proof_across_name_input_boundary", () => {
    // The name/input delimiter is NUL (\u0000), which cannot occur in a tool name — so a name
    // ending in text and an input beginning with that text never alias. A space delimiter WOULD
    // collide here ("a b" + "c" vs "a" + "b c" → "a b c" both ways); this pins the stronger choice.
    expect(signatureOf({ name: "a b", input: "c" })).not.toBe(
      signatureOf({ name: "a", input: "b c" }),
    );
  });

  it("test_signature_is_array_order_sensitive", () => {
    // Arrays are ordered — [1,2] and [2,1] are different tool arguments, so different signatures.
    expect(signatureOf({ name: "t", input: [1, 2] })).not.toBe(
      signatureOf({ name: "t", input: [2, 1] }),
    );
  });

  it("test_signature_canonicalizes_nested_object_key_order", () => {
    // Key-sort recurses: nested {a,b} and {b,a} canonicalize identically.
    expect(signatureOf({ name: "t", input: { x: { a: 1, b: 2 } } })).toBe(
      signatureOf({ name: "t", input: { x: { b: 2, a: 1 } } }),
    );
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

  it("test_soft_ge_hard_suppresses_nudge_and_still_hard_stops", () => {
    // Documented (not rejected) config: soft >= hard means the nudge never fires (hard is checked
    // first and wins). Ergonomic case: `{ hardThreshold: 2 }` keeps the default soft=3 → no nudge.
    const t = new DoomLoopTracker({ hardThreshold: 2 }); // soft defaults to 3 (>= hard)
    expect(t.inspect(call()).kind).toBe("ok"); // 1
    expect(t.inspect(call()).kind).toBe("hard"); // 2 — hard stop, "soft" never emitted
  });
});

describe("createDoomLoopTracker / threshold validation (fail-fast)", () => {
  it("test_false_option_disables_guard", () => {
    expect(createDoomLoopTracker(false)).toBeUndefined();
  });

  it("test_absent_option_enables_default_guard", () => {
    expect(createDoomLoopTracker()).toBeInstanceOf(DoomLoopTracker);
    expect(createDoomLoopTracker({})).toBeInstanceOf(DoomLoopTracker);
  });

  it("test_rejects_zero_threshold_with_typed_error", () => {
    // NEGATIVE case (testing.md §4.1): the first invalid value past the boundary is a typed error,
    // not a silent stop-on-turn-1. Asserts the specific ConfigurationError, not merely "throws".
    expect(() => createDoomLoopTracker({ hardThreshold: 0 })).toThrow(ConfigurationError);
    expect(() => createDoomLoopTracker({ hardThreshold: 0 })).toThrow(/positive integer/);
  });

  it("test_rejects_negative_threshold_with_typed_error", () => {
    expect(() => createDoomLoopTracker({ softThreshold: -1 })).toThrow(ConfigurationError);
  });

  it("test_rejects_non_integer_threshold_with_typed_error", () => {
    // A non-integer soft would make `count === softThreshold` never true → the nudge silently
    // never fires. Fail-fast instead.
    expect(() => createDoomLoopTracker({ softThreshold: 2.5 })).toThrow(ConfigurationError);
    expect(() => createDoomLoopTracker({ hardThreshold: Number.NaN })).toThrow(ConfigurationError);
  });
});
