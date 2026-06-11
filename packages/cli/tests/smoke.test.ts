/**
 * Smoke tests for @theokit/cli (T0.1).
 *
 * Verifies:
 *  - Programmatic entry `main()` is exported and returns Promise<number>.
 *  - `main([])` resolves to 0 (no-args banner is benign).
 *  - `--version` flag emits the build-time CLI_VERSION constant.
 */

import { describe, expect, it, vi } from "vitest";

import { CLI_VERSION, main } from "../src/index.js";

describe("@theokit/cli smoke (T0.1)", () => {
  it("exports main as a function returning Promise<number>", () => {
    expect(typeof main).toBe("function");
    const result = main([]);
    expect(result).toBeInstanceOf(Promise);
  });

  it("main([]) resolves to 0", async () => {
    const code = await main(["node", "theokit"]);
    expect(code).toBe(0);
  });

  it("--version emits CLI_VERSION to stdout", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const code = await main(["node", "theokit", "--version"]);
    expect(code).toBe(0);
    const written = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toContain(CLI_VERSION);
    writeSpy.mockRestore();
  });

  it("CLI_VERSION is a valid semver string", () => {
    expect(CLI_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
