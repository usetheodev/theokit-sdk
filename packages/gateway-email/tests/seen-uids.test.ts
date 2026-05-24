/**
 * `SeenUidSet` tests (T2.3, D331).
 */

import { describe, expect, it } from "vitest";

import { SeenUidSet } from "../src/seen-uids.js";

describe("SeenUidSet", () => {
  it("test_seen_uid_set_has_returns_false_for_unknown", () => {
    const s = new SeenUidSet();
    expect(s.has(42)).toBe(false);
  });

  it("test_seen_uid_set_add_then_has", () => {
    const s = new SeenUidSet();
    s.add(42);
    expect(s.has(42)).toBe(true);
  });

  it("test_seen_uid_set_caps_at_5000_with_fifo_trim — inserting 6000 UIDs drops oldest", () => {
    const s = new SeenUidSet();
    for (let i = 0; i < 6000; i += 1) s.add(i);
    expect(s.size).toBeLessThanOrEqual(SeenUidSet.MAX_SIZE);
    // Oldest dropped, newest preserved.
    expect(s.has(5999)).toBe(true);
    expect(s.has(0)).toBe(false);
  });

  it("test_seen_uid_set_clear_empties", () => {
    const s = new SeenUidSet();
    s.add(1);
    s.add(2);
    s.clear();
    expect(s.size).toBe(0);
    expect(s.has(1)).toBe(false);
  });
});
