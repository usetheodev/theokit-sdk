import { describe, expect, it } from "vitest";
import * as barrel from "../src/internal/memory/storage/index.js";
import * as store from "../src/internal/memory/storage/markdown-store.js";
import * as root from "../src/internal/memory/storage/memory-root.js";

/*
 * The shared markdown store (#430).
 *
 * `@theokit/sdk-memory` used to carry a full copy of this store, and `Memory.runDreamingSweep`
 * swaps this implementation for the peer's whenever the peer is installed — so the copy that ran
 * was not the copy anyone maintained. It stayed on the pre-#389 layout and stopped finding the
 * files this one writes; the symptom was `factsBefore: 0`, which reads exactly like an empty store.
 *
 * The sub-path below is what lets the satellite import this store instead of copying it, the same
 * remedy theokit#160 applied to the embedding runtime in the same package pair.
 *
 * The barrel spans TWO modules since #463: root resolution moved out of the store into
 * `memory-root.ts`, because fourteen call sites answering "where does memory live?" is thirteen
 * chances to answer it differently. The guarantee below is unchanged — every name the barrel
 * offers is the function itself, from whichever of the two owns it.
 */
describe("the internal/memory-store sub-path", () => {
  // A name that leaves the store but never reaches the barrel is a name the satellite has to
  // reimplement, which is how the copy grew in the first place.
  it("test_it_offers_every_function_the_store_exports", () => {
    const exported = Object.keys(store).filter(
      (name) => typeof (store as Record<string, unknown>)[name] === "function",
    );
    expect(exported.length).toBeGreaterThan(0);
    for (const name of exported) expect(barrel).toHaveProperty(name);

    const rootExports = Object.keys(root).filter(
      (name) => typeof (root as Record<string, unknown>)[name] === "function",
    );
    expect(rootExports.length).toBeGreaterThan(0);
    for (const name of rootExports) expect(barrel).toHaveProperty(name);
  });

  // The accepted input's counterpart (rules/testing.md § 4.2): re-exports must be the SAME
  // functions, not same-named wrappers — a wrapper is a second implementation wearing the name.
  it("test_each_re_export_is_the_source_function_itself", () => {
    const sources = { ...store, ...root } as Record<string, unknown>;
    for (const [name, value] of Object.entries(barrel)) {
      expect(sources).toHaveProperty(name);
      expect(value).toBe(sources[name]);
    }
  });
});
