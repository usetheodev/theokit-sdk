/**
 * T5.1 EC-F (path-guard on --output) tests.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { main } from "../../src/index.js";

let savedCwd: string;
let scratch: string;
beforeEach(() => {
  savedCwd = process.cwd();
  scratch = mkdtempSync(join(tmpdir(), "tk-eval-"));
  process.chdir(scratch);
});
afterEach(() => {
  process.chdir(savedCwd);
  rmSync(scratch, { recursive: true, force: true });
});

describe("eval --output path-guard (EC-F)", () => {
  it("rejects ../../etc/passwd (traversal)", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await main(["node", "theokit", "eval", "--output", "../../etc/passwd"]);
    expect(code).toBe(2);
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toMatch(/inside the current working directory|invalid_output_path/);
    stderrSpy.mockRestore();
  });

  it("rejects absolute path outside cwd", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await main(["node", "theokit", "eval", "--output", "/etc/passwd-report.md"]);
    expect(code).toBe(2);
    stderrSpy.mockRestore();
  });

  it("rejects symbolic ../escape that resolves outside cwd", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await main([
      "node",
      "theokit",
      "eval",
      "--output",
      "../../../../../../../../tmp/escape.md",
    ]);
    expect(code).toBe(2);
    stderrSpy.mockRestore();
  });
});
