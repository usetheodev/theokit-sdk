/**
 * Folding configuration layers in a declared order — B-097's second slice.
 *
 * Two rules that every layered-config product rebuilds, and one trap.
 *
 * The rules: later layers win, and named keys ACCUMULATE instead of being replaced. The trap is
 * that accumulation is not a nicety — for a key like `hooks`, last-wins means a project file can
 * DISPLACE the user's global entries rather than adding to them, and hooks are arbitrary command
 * execution. The accumulating set is the difference between a repository adding a hook and a
 * repository removing yours.
 *
 * Generic by the same test that let the security floor through: the layer NAMES are data supplied
 * by the caller, not a union baked into the framework. One consumer's chain is
 * defaults/user/project/profile/env/cli, and `profile` is that product's idea.
 */

import { describe, expect, it } from "vitest";

import { foldLayers, verifyLayerOrdering } from "../src/layer-fold.js";

const CHAIN = [
  { layer: "defaults", precedence: 10 },
  { layer: "user", precedence: 20 },
  { layer: "project", precedence: 30 },
] as const;

describe("verifyLayerOrdering", () => {
  it("test_a_strictly_ascending_chain_is_accepted", () => {
    expect(() => verifyLayerOrdering([...CHAIN])).not.toThrow();
  });

  it("test_a_chain_where_a_layer_does_not_outrank_its_predecessor_is_refused", () => {
    // Silently tolerating this would make resolution depend on array order rather than on the
    // declared precedence — two sources of truth for one decision.
    expect(() =>
      verifyLayerOrdering([
        { layer: "user", precedence: 20 },
        { layer: "project", precedence: 20 },
      ]),
    ).toThrow(/does not outrank/);
  });

  it("test_the_refusal_names_both_layers_and_both_precedences", () => {
    // A refusal that only says "out of order" sends the reader to compare the whole list by hand.
    try {
      verifyLayerOrdering([
        { layer: "env", precedence: 50 },
        { layer: "project", precedence: 30 },
      ]);
      throw new Error("expected a throw");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain("project");
      expect(message).toContain("30");
      expect(message).toContain("env");
      expect(message).toContain("50");
    }
  });

  it("test_an_empty_or_single_chain_is_accepted", () => {
    expect(() => verifyLayerOrdering([])).not.toThrow();
    expect(() => verifyLayerOrdering([{ layer: "only", precedence: 1 }])).not.toThrow();
  });
});

describe("foldLayers — later layers win", () => {
  it("test_a_later_layer_replaces_an_earlier_value", () => {
    const out = foldLayers([
      { layer: "defaults", values: { model: "small" } },
      { layer: "user", values: { model: "large" } },
    ]);
    expect(out.model).toBe("large");
  });

  it("test_undefined_does_not_overwrite_what_an_earlier_layer_set", () => {
    // A layer that simply does not mention a key must not erase it. This is the difference between
    // "the user set nothing" and "the user set nothing ON PURPOSE", and only the first is common.
    const out = foldLayers([
      { layer: "defaults", values: { model: "small" } },
      { layer: "user", values: { model: undefined } },
    ]);
    expect(out.model).toBe("small");
  });

  it("test_keys_only_one_layer_mentions_survive", () => {
    const out = foldLayers([
      { layer: "defaults", values: { a: 1 } },
      { layer: "user", values: { b: 2 } },
    ]);
    expect(out).toEqual({ a: 1, b: 2 });
  });

  it("test_no_layers_folds_to_nothing", () => {
    expect(foldLayers([])).toEqual({});
  });
});

describe("foldLayers — accumulating keys", () => {
  it("test_an_accumulating_key_concatenates_instead_of_replacing", () => {
    // The reason this exists. With last-wins, a project file DISPLACES the user's hooks rather than
    // adding to them — and a hook is arbitrary command execution on every tool call.
    const out = foldLayers(
      [
        { layer: "user", values: { hooks: ["user-hook"] } },
        { layer: "project", values: { hooks: ["project-hook"] } },
      ],
      ["hooks"],
    );
    expect(out.hooks).toEqual(["user-hook", "project-hook"]);
  });

  it("test_a_key_not_declared_accumulating_still_replaces", () => {
    // Anti-vacuity: if every array accumulated, the case above would pass while the rule was
    // "arrays always concatenate", which is not it — most list-valued settings DO replace.
    const out = foldLayers([
      { layer: "user", values: { skills: ["a"] } },
      { layer: "project", values: { skills: ["b"] } },
    ]);
    expect(out.skills).toEqual(["b"]);
  });

  it("test_a_non_array_value_for_an_accumulating_key_replaces_rather_than_appending", () => {
    // A malformed config must not corrupt the accumulator into a mixed list. Replacing is the
    // honest outcome and leaves the value visible for the consumer's own validation to reject.
    const out = foldLayers(
      [
        { layer: "user", values: { hooks: ["user-hook"] } },
        { layer: "project", values: { hooks: "not-a-list" } },
      ],
      ["hooks"],
    );
    expect(out.hooks).toBe("not-a-list");
  });

  it("test_accumulation_does_not_leak_between_calls", () => {
    // The accumulator is per-fold. A module-level one would make the second call inherit the first
    // call's hooks — the shape of bug that only appears once two sessions run in one process.
    const entries = [{ layer: "user", values: { hooks: ["h"] } }];
    expect(foldLayers(entries, ["hooks"]).hooks).toEqual(["h"]);
    expect(foldLayers(entries, ["hooks"]).hooks).toEqual(["h"]);
  });

  it("test_the_caller_input_is_not_mutated", () => {
    // Folding must be a read. A consumer that folds twice — once to display, once to apply — would
    // otherwise get a different answer the second time.
    //
    // Note on what this does NOT prove: the implementation also copies the accumulator before
    // returning it, and that copy is unobservable — mutating it away leaves every case here green.
    // It is defensive, not load-bearing, and the source says so rather than letting a reader assume
    // a test stands behind it.
    const userValues = { hooks: ["h"] };
    const entries = [{ layer: "user", values: userValues }];
    foldLayers(entries, ["hooks"]);
    foldLayers(entries, ["hooks"]);
    expect(userValues.hooks).toEqual(["h"]);
  });
});

describe("foldLayers — the ordering is enforced, not assumed", () => {
  it("test_entries_out_of_declared_order_are_refused", () => {
    // The fold trusts array order; the check is what makes that trust safe.
    expect(() =>
      foldLayers([
        { layer: "project", values: {}, precedence: 30 },
        { layer: "user", values: {}, precedence: 20 },
      ]),
    ).toThrow(/does not outrank/);
  });

  it("test_entries_without_declared_precedence_are_folded_in_the_order_given", () => {
    // Precedence is optional: a caller that already holds its layers in order should not have to
    // restate it. Omitting it means "this array is the order".
    const out = foldLayers([
      { layer: "a", values: { k: 1 } },
      { layer: "b", values: { k: 2 } },
    ]);
    expect(out.k).toBe(2);
  });
});
