/**
 * T1.1 — pure `sanitizeToolInput` primitive (plan tool-input-sanitization, blueprint SHIPPABLE 98.0).
 *
 * Behaviour lens (rules/testing.md § 4.1): EDGE cases (extremes of valid — trim, multi-block,
 * JSON-string args) AND NEGATIVE cases (invalid input / would-corrupt — non-object, big-int
 * coercion, plaintext repair, non-object schema). The contract is TOTAL: never throws, only
 * changes hygiene/representation, never meaning. RED set mirrors agentfw's coerceParameter tests
 * (.claude/knowledge-base/references/agentfw/.../xml-tool-calls.test.ts).
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { sanitizeToolInput } from "../../src/sanitize/sanitize-tool-input.js";

describe("sanitizeToolInput — trim (default)", () => {
  it("test_trim_is_default_on", () => {
    const r = sanitizeToolInput({ path: "\npackage.json\n" });
    expect(r.value).toEqual({ path: "package.json" });
    expect(r.changed).toBe(true);
  });

  it("test_trim_preserves_internal_newlines", () => {
    const r = sanitizeToolInput({ command: "\nline1\nline2\n" });
    expect(r.value).toEqual({ command: "line1\nline2" });
  });

  it("test_no_options_is_trim_only_strings_stay_strings", () => {
    const r = sanitizeToolInput({ n: "5" });
    expect(r.value).toEqual({ n: "5" });
    expect(r.changed).toBe(false);
  });

  it("test_whitespace_only_trims_to_empty", () => {
    const r = sanitizeToolInput({ x: "   " });
    expect(r.value).toEqual({ x: "" });
    expect(r.changed).toBe(true);
  });

  it("test_clean_input_is_noop_changed_false", () => {
    const r = sanitizeToolInput({ path: "a.ts" });
    expect(r.changed).toBe(false);
    expect(r.notes).toEqual([]);
  });

  it("test_non_string_values_untouched", () => {
    const r = sanitizeToolInput({ n: 5, arr: [1, 2] });
    expect(r.value).toEqual({ n: 5, arr: [1, 2] });
    expect(r.changed).toBe(false);
  });

  it("test_empty_input", () => {
    const r = sanitizeToolInput({});
    expect(r).toEqual({ value: {}, changed: false, notes: [] });
  });

  it("test_notes_records_each_change", () => {
    const r = sanitizeToolInput({ a: " x ", b: " y " });
    expect(r.notes.length).toBe(2);
  });
});

describe("sanitizeToolInput — coerce (opt-in)", () => {
  it("test_coerce_string_number", () => {
    expect(sanitizeToolInput({ n: "5" }, { coerce: true }).value).toEqual({ n: 5 });
  });

  it("test_coerce_string_boolean", () => {
    expect(sanitizeToolInput({ b: "true" }, { coerce: true }).value).toEqual({ b: true });
    expect(sanitizeToolInput({ b: "false" }, { coerce: true }).value).toEqual({ b: false });
  });

  it("test_coerce_string_null", () => {
    expect(sanitizeToolInput({ x: "null" }, { coerce: true }).value).toEqual({ x: null });
  });

  it("test_coerce_json_encoded_array", () => {
    expect(sanitizeToolInput({ a: '["x","y"]' }, { coerce: true }).value).toEqual({
      a: ["x", "y"],
    });
  });

  it("test_coerce_json_encoded_object", () => {
    expect(sanitizeToolInput({ o: '{"k":1}' }, { coerce: true }).value).toEqual({ o: { k: 1 } });
  });

  it("test_coerce_non_coercible_stays_string", () => {
    expect(sanitizeToolInput({ s: "hello" }, { coerce: true }).value).toEqual({ s: "hello" });
  });

  // EC-2 — no ID / precision corruption (round-trip + finite guard)
  it("test_coerce_bigint_string_stays_string", () => {
    expect(sanitizeToolInput({ id: "12345678901234567890" }, { coerce: true }).value).toEqual({
      id: "12345678901234567890",
    });
  });

  it("test_coerce_leading_zero_stays_string", () => {
    expect(sanitizeToolInput({ code: "007" }, { coerce: true }).value).toEqual({ code: "007" });
  });

  it("test_coerce_nan_infinity_stays_string", () => {
    const r = sanitizeToolInput({ a: "NaN", b: "Infinity" }, { coerce: true });
    expect(r.value).toEqual({ a: "NaN", b: "Infinity" });
  });
});

describe("sanitizeToolInput — schema-aware coerce", () => {
  it("test_schema_aware_coerce_only_where_schema_expects", () => {
    const schema = z.object({ n: z.number(), s: z.string() });
    const r = sanitizeToolInput({ n: "5", s: "5" }, { coerce: true, schema });
    expect(r.value).toEqual({ n: 5, s: "5" });
  });

  // EC-4 — non-object schema falls back safely, never throws
  it("test_schema_union_or_record_falls_back_no_throw", () => {
    const union = z.union([z.string(), z.number()]);
    expect(() => sanitizeToolInput({ x: "5" }, { coerce: true, schema: union })).not.toThrow();
    const record = z.record(z.string(), z.number());
    expect(() => sanitizeToolInput({ x: "5" }, { coerce: true, schema: record })).not.toThrow();
  });
});

describe("sanitizeToolInput — repairJson (opt-in)", () => {
  it("test_repair_json_malformed_string", () => {
    expect(sanitizeToolInput({ o: "{k:1}" }, { repairJson: true }).value).toEqual({ o: { k: 1 } });
  });

  it("test_repair_json_off_by_default", () => {
    expect(sanitizeToolInput({ o: "{k:1}" }).value).toEqual({ o: "{k:1}" });
  });

  // EC-3 — repair only JSON-looking values
  it("test_repairJson_leaves_plaintext_untouched", () => {
    expect(sanitizeToolInput({ note: "hello world" }, { repairJson: true }).value).toEqual({
      note: "hello world",
    });
  });
});

describe("sanitizeToolInput — deep (opt-in, bounded)", () => {
  it("test_deep_off_by_default_shallow_only", () => {
    const r = sanitizeToolInput({ a: { b: " x " } });
    expect(r.value).toEqual({ a: { b: " x " } });
  });

  it("test_deep_on_recurses", () => {
    const r = sanitizeToolInput({ a: { b: " x " } }, { deep: true });
    expect(r.value).toEqual({ a: { b: "x" } });
  });

  // EC-6 — bounded recursion, no stack overflow
  it("test_deep_recursion_bounded_by_maxDepth", () => {
    let nested: Record<string, unknown> = { leaf: " deep " };
    for (let i = 0; i < 20; i++) nested = { child: nested };
    expect(() => sanitizeToolInput(nested, { deep: true, maxDepth: 4 })).not.toThrow();
  });
});

describe("sanitizeToolInput — total contract (never throws)", () => {
  // EC-1 — non-object input returns as-is, no throw
  it("test_non_object_input_returns_as_is_no_throw", () => {
    for (const bad of [null, undefined, ["x"], "s", 5, true] as unknown[]) {
      const r = sanitizeToolInput(bad as Record<string, unknown>);
      expect(r).toEqual({ value: bad, changed: false, notes: [] });
    }
  });

  it("test_never_throws_on_weird_input", () => {
    const weird = { sym: Symbol("x") as unknown, fn: (() => 1) as unknown };
    expect(() => sanitizeToolInput(weird as Record<string, unknown>)).not.toThrow();
  });
});

describe("sanitizeToolInput — review-hardening (Finding 1 + coverage gaps)", () => {
  // Review Finding 1 (HIGH) regression: coerce+repairJson must NOT clobber a schema-confirmed
  // raw string (a z.string() field holding a JSON-looking value) back into an object.
  it("test_coerce_and_repairJson_keep_schema_confirmed_string_field", () => {
    const schema = z.object({ payload: z.string() });
    const r = sanitizeToolInput(
      { payload: '{"key":"val"}' },
      { coerce: true, repairJson: true, schema },
    );
    expect(r.value).toEqual({ payload: '{"key":"val"}' });
    expect(schema.safeParse(r.value).success).toBe(true);
  });

  // coerce+repairJson STILL repairs into an object field (via coerceCandidates), not lost.
  it("test_coerce_and_repairJson_repairs_into_object_field", () => {
    const schema = z.object({ o: z.object({ k: z.number() }) });
    const r = sanitizeToolInput({ o: "{k:1}" }, { coerce: true, repairJson: true, schema });
    expect(r.value).toEqual({ o: { k: 1 } });
  });

  it("test_coerce_scientific_notation_stays_string", () => {
    expect(sanitizeToolInput({ n: "1e3" }, { coerce: true }).value).toEqual({ n: "1e3" });
  });

  it("test_schema_union_fallback_heuristic_coerces_value", () => {
    const union = z.union([z.string(), z.number()]);
    const r = sanitizeToolInput({ x: "5" }, { coerce: true, schema: union });
    expect(r.value).toEqual({ x: 5 });
    expect(r.changed).toBe(true);
  });

  it("test_deep_recursion_leaves_values_beyond_maxDepth_untouched", () => {
    let nested: Record<string, unknown> = { leaf: " deep " };
    for (let i = 0; i < 20; i++) nested = { child: nested };
    const r = sanitizeToolInput(nested, { deep: true, maxDepth: 2 });
    // Walk to the leaf and confirm it kept its surrounding whitespace (was beyond the cap).
    let cur: Record<string, unknown> = r.value;
    while (cur && typeof cur === "object" && "child" in cur)
      cur = cur.child as Record<string, unknown>;
    expect(cur.leaf).toBe(" deep ");
  });

  it("test_deep_and_coerce_combination", () => {
    const r = sanitizeToolInput({ a: { n: "5" } }, { deep: true, coerce: true });
    expect(r.value).toEqual({ a: { n: 5 } });
  });

  it("test_repair_json_malformed_array", () => {
    expect(sanitizeToolInput({ a: '["x","y"' }, { repairJson: true }).value).toEqual({
      a: ["x", "y"],
    });
  });

  it("test_trim_false_suppresses_default_trim", () => {
    expect(sanitizeToolInput({ path: "\na.ts\n" }, { trim: false }).value).toEqual({
      path: "\na.ts\n",
    });
  });

  it("test_coerce_true_leaves_already_typed_values_alone", () => {
    const r = sanitizeToolInput({ n: 5, b: true }, { coerce: true });
    expect(r.value).toEqual({ n: 5, b: true });
    expect(r.changed).toBe(false);
  });

  it("test_notes_content_is_stable", () => {
    const r = sanitizeToolInput({ a: " x ", n: "5" }, { coerce: true });
    expect(r.notes).toContain('trimmed "a"');
    expect(r.notes).toContain('coerced "n"');
    expect(r.changed).toBe(true);
  });
});

describe("sanitizeToolInput — arrays", () => {
  // The @public docblock on SanitizeOptions.deep said "Recurse into nested objects/arrays" and arrays
  // were never descended, by ANY rung — including trim, which is on by default. A model that emitted
  // `{ tags: ["  a  "] }` got it back untouched while `{ tag: "  a  " }` was trimmed, and nothing in
  // the type or the docs distinguished the two.

  it("trims string elements of a top-level array, with trim on by default", () => {
    const result = sanitizeToolInput({ tags: ["  a  ", "b\n"] });
    expect(result.value).toEqual({ tags: ["a", "b"] });
    expect(result.changed).toBe(true);
  });

  it("leaves non-string elements alone", () => {
    const result = sanitizeToolInput({ mixed: [1, true, null, "  x  "] });
    expect(result.value).toEqual({ mixed: [1, true, null, "x"] });
  });

  it("descends into objects inside arrays only under deep, like objects elsewhere", () => {
    const input = { items: [{ name: "  padded  " }] };
    expect(
      sanitizeToolInput(input).value,
      "shallow: the object inside the array is untouched",
    ).toEqual({
      items: [{ name: "  padded  " }],
    });
    expect(sanitizeToolInput(input, { deep: true }).value).toEqual({ items: [{ name: "padded" }] });
  });

  it("respects maxDepth through arrays, so a deep structure cannot recurse without bound", () => {
    const input = { a: [{ b: [{ c: { d: "  deep  " } }] }] };
    // Each array hop and each object hop costs a level, so depth 2 stops before `d`.
    expect(sanitizeToolInput(input, { deep: true, maxDepth: 2 }).value).toEqual(input);
    expect(sanitizeToolInput(input, { deep: true, maxDepth: 8 }).value).toEqual({
      a: [{ b: [{ c: { d: "deep" } }] }],
    });
  });

  it("does not turn an array into an object", () => {
    // The obvious way to implement this — reuse the object walker — silently converts `[…]` into
    // `{ "0": … }`, which a tool handler doing `Array.isArray` would then reject.
    const result = sanitizeToolInput({ tags: ["  a  "] });
    expect(Array.isArray((result.value as { tags: unknown }).tags)).toBe(true);
  });
});
