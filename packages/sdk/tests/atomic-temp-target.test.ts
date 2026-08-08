/**
 * U-9 — the SDK recognises its own leftover temp files.
 *
 * `replaceFileAtomic` writes to `<file>.<pid>.<hex>.tmp`, fsyncs, then renames. A crash between the
 * open and the rename leaves that temp behind, and nothing ever collects it — the SDK creates them
 * and has no opinion about cleaning them up.
 *
 * So a consumer that wants to sweep them has to know the naming convention, and the convention lives
 * only in the implementation: no typing declares it. TheoCode ended up copying it out of a compiled
 * chunk as a regex (`/^(.+?)\.\d+\.[0-9a-f]+\.tmp$/`, finding PS-010), which would have degraded
 * silently — reporting "nothing to collect" — the moment the format changed upstream.
 *
 * This exposes the recogniser, derived from the same builder the writer uses, so a rename of the
 * format cannot leave a consumer's sweeper quietly matching nothing.
 */
import { describe, expect, it } from "vitest";

import { atomicWriteTempTarget } from "../src/persistence.js";

describe("U-9 — a leftover temp names the file it was replacing", () => {
  it("test_a_temp_written_by_this_sdk_is_recognised", () => {
    expect(atomicWriteTempTarget("session.json.12345.a1b2c3d4e5f6a7b8.tmp")).toBe("session.json");
  });

  it("test_a_target_containing_dots_survives", () => {
    expect(atomicWriteTempTarget("a.b.c.jsonl.999.0011223344556677.tmp")).toBe("a.b.c.jsonl");
  });

  it("test_an_unrelated_tmp_file_is_not_claimed", () => {
    // Anti-vacuity floor: stripping any `.tmp` would pass the cases above and collect other
    // people's files, on a path whose whole job is deleting things.
    expect(atomicWriteTempTarget("vim-swap.tmp")).toBeUndefined();
    expect(atomicWriteTempTarget("session.json.notapid.deadbeef.tmp")).toBeUndefined();
    expect(atomicWriteTempTarget("session.json.123.NOTHEX.tmp")).toBeUndefined();
  });

  it("test_a_plain_file_is_not_claimed", () => {
    expect(atomicWriteTempTarget("session.json")).toBeUndefined();
  });
});
