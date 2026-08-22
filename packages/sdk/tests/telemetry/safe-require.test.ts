import { describe, expect, it } from "vitest";
import { safeRequire } from "../../src/internal/telemetry/safe-require.js";

/**
 * `safeRequire` is the single point where every optional telemetry peer-dep is
 * resolved (ADR D42). Its whole contract is that a MISSING dependency degrades
 * to `undefined` instead of throwing — if it ever threw, importing the adapter
 * registry would take down agent startup for users who installed no telemetry
 * backend at all.
 */
describe("safeRequire", () => {
  it("returns the module when it is installed", () => {
    const mod = safeRequire<typeof import("node:path")>("node:path");

    expect(mod).toBeDefined();
    expect(typeof mod?.join).toBe("function");
  });

  it("returns undefined instead of throwing when the module is absent", () => {
    const mod = safeRequire("@theokit/definitely-not-installed-abcxyz");

    expect(mod).toBeUndefined();
  });

  it("does not throw on a malformed specifier", () => {
    expect(() => safeRequire("")).not.toThrow();
    expect(safeRequire("")).toBeUndefined();
  });

  it("resolves a real module rather than reporting every name as present", () => {
    // § 4.2 — the accepting direction. A `safeRequire` hard-wired to return
    // undefined would pass both absence tests above while silently disabling
    // every telemetry adapter in the product.
    expect(safeRequire("node:os")).toBeDefined();
    expect(safeRequire("node:nope-not-a-builtin")).toBeUndefined();
  });
});
