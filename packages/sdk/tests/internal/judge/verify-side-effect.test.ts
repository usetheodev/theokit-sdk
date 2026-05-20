/**
 * Tests for side-effect verification (T2.3).
 */

import { describe, expect, it } from "vitest";

import { verifyClaim } from "../../../src/internal/judge/verify-side-effect.js";

describe("verifyClaim (T2.3)", () => {
  it("empty claims yields empty buckets", async () => {
    const r = await verifyClaim<string>([], async () => true);
    expect(r.verified).toEqual([]);
    expect(r.phantom).toEqual([]);
  });

  it("all truthful oracle yields all verified", async () => {
    const r = await verifyClaim(["a", "b", "c"], async () => true);
    expect(r.verified).toEqual(["a", "b", "c"]);
    expect(r.phantom).toEqual([]);
  });

  it("falsy oracle yields all phantom", async () => {
    const r = await verifyClaim(["x", "y"], async () => false);
    expect(r.verified).toEqual([]);
    expect(r.phantom).toEqual(["x", "y"]);
  });

  it("partial phantom detection", async () => {
    const exists = new Set(["real-1", "real-2"]);
    const r = await verifyClaim(["real-1", "real-2", "phantom-3"], async (id) => exists.has(id));
    expect(r.verified).toEqual(["real-1", "real-2"]);
    expect(r.phantom).toEqual(["phantom-3"]);
  });

  it("oracle throw propagates to caller", async () => {
    await expect(
      verifyClaim(["a"], async () => {
        throw new Error("oracle down");
      }),
    ).rejects.toThrow("oracle down");
  });
});
