import { describe, expect, it } from "vitest";
import { langsmithAdapter } from "../../src/internal/telemetry/adapters/langsmith.js";
import { safeRequire } from "../../src/internal/telemetry/safe-require.js";

describe("langsmith adapter", () => {
  it("has correct moduleName and displayName", () => {
    expect(langsmithAdapter.moduleName).toEqual("langsmith");
    expect(langsmithAdapter.displayName).toEqual("LangSmith");
  });

  /**
   * The old assertion was `expect(typeof result).toEqual("boolean")`, which cannot fail for any
   * implementation the compiler accepts — `detect` is typed `() => boolean`. Replacing it with the
   * siblings' `detect() === false` looked obvious and is WRONG here, which is what the weak form was
   * hiding: `langsmith` is present in this workspace as a transitive dependency, so
   * `createRequire`-based resolution finds it and `detect()` is true. Measured 2026-09-02.
   *
   * So this asserts the RELATIONSHIP, which holds either way: detect answers presence, and nothing
   * else.
   */
  it("detect answers whether the module resolves, and nothing else", () => {
    expect(langsmithAdapter.detect()).toBe(safeRequire("langsmith") !== undefined);
  });

  /**
   * `expect(() => register()).not.toThrow()` was the whole assertion, in this file and in all four
   * siblings, and it passes against a no-op. This is the invariant that does not depend on whether
   * the vendor happens to be installed: LangSmith auto-instruments from LANGCHAIN_TRACING_V2, so
   * this adapter installs nothing BY DESIGN and may never report that it did.
   */
  it("never reports that it instrumented anything, because it cannot", () => {
    expect(langsmithAdapter.register()).not.toBe("instrumented");
  });
});
