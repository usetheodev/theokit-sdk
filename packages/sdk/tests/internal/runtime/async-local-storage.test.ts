/**
 * Tests for per-fork AsyncLocalStorage tool whitelist (ADR D111).
 *
 * Verifies that:
 * - currentToolWhitelist returns undefined outside withToolWhitelist
 * - withToolWhitelist propagates whitelist via async chain
 * - parallel forks have independent whitelists (no global mutation)
 * - checkToolWhitelist allows all when no fork context
 * - nested withToolWhitelist shadows outer (EC-F)
 */

import { describe, expect, it } from "vitest";

import {
  checkToolWhitelist,
  currentToolWhitelist,
  withToolWhitelist,
} from "../../../src/internal/runtime/async-local-storage.js";

describe("async-local-storage (T1.1)", () => {
  it("currentToolWhitelist returns undefined outside withToolWhitelist", () => {
    expect(currentToolWhitelist()).toBeUndefined();
  });

  it("withToolWhitelist makes set visible inside fn", async () => {
    const whitelist = new Set(["a", "b"]);
    const captured = await withToolWhitelist(whitelist, async () => currentToolWhitelist());
    expect(captured).toBe(whitelist);
  });

  it("parallel forks have independent whitelists", async () => {
    const setA = new Set(["a"]);
    const setB = new Set(["b"]);
    const setC = new Set(["c"]);
    const [a, b, c] = await Promise.all([
      withToolWhitelist(setA, async () => {
        await new Promise((r) => setTimeout(r, 1));
        return currentToolWhitelist();
      }),
      withToolWhitelist(setB, async () => {
        await new Promise((r) => setTimeout(r, 1));
        return currentToolWhitelist();
      }),
      withToolWhitelist(setC, async () => {
        await new Promise((r) => setTimeout(r, 1));
        return currentToolWhitelist();
      }),
    ]);
    expect(a).toBe(setA);
    expect(b).toBe(setB);
    expect(c).toBe(setC);
  });

  it("checkToolWhitelist outside context allows all tools", () => {
    expect(checkToolWhitelist("anything")).toEqual({ allowed: true });
  });

  it("checkToolWhitelist inside context filters by membership", async () => {
    await withToolWhitelist(new Set(["allowed-tool"]), async () => {
      expect(checkToolWhitelist("allowed-tool")).toEqual({ allowed: true });
      const denied = checkToolWhitelist("blocked-tool");
      expect(denied.allowed).toBe(false);
      expect(denied.reason).toContain("blocked-tool");
      expect(denied.reason).toContain("fork");
    });
  });

  // EC-F (edge-case review): nested withToolWhitelist — inner shadows outer
  it("nested withToolWhitelist: inner whitelist shadows outer", async () => {
    const outer = new Set(["outer-only"]);
    const inner = new Set(["inner-only"]);
    const captured = await withToolWhitelist(outer, async () => {
      return withToolWhitelist(inner, async () => currentToolWhitelist());
    });
    expect(captured).toBe(inner);
  });

  it("nested whitelist: outer is restored after inner returns", async () => {
    const outer = new Set(["outer"]);
    const inner = new Set(["inner"]);
    const captured = await withToolWhitelist(outer, async () => {
      await withToolWhitelist(inner, async () => currentToolWhitelist());
      return currentToolWhitelist();
    });
    expect(captured).toBe(outer);
  });

  it("returns the inner function's return value", async () => {
    const result = await withToolWhitelist(new Set(), async () => 42);
    expect(result).toBe(42);
  });
});
