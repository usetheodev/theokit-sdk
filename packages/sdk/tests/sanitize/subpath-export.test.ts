/**
 * T1.2 — the `@theokit/sdk/sanitize` subpath barrel exposes exactly the public surface.
 * Build-level proof (dual ESM+CJS + .d.ts/.d.cts artifacts, publint/attw) is in the task DoD
 * (`pnpm build` + `pnpm validate`); this asserts the source barrel contract.
 */
import { describe, expect, it } from "vitest";
import * as sanitizeBarrel from "../../src/sanitize/index.js";

describe("@theokit/sdk/sanitize barrel", () => {
  it("test_barrel_exports_public_surface", () => {
    expect(typeof sanitizeBarrel.sanitizeToolInput).toBe("function");
  });

  it("test_barrel_exports_only_the_public_symbols", () => {
    // Types are erased at runtime; the sole runtime export is the primitive.
    expect(Object.keys(sanitizeBarrel)).toEqual(["sanitizeToolInput"]);
  });
});
