/**
 * T4.1 entry-resolver tests.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveEntry } from "../../src/dev/entry-resolver.js";

let workDir: string;
beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "tk-entry-"));
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("resolveEntry (T4.1)", () => {
  it("explicit --entry wins", () => {
    const path = join(workDir, "bot.ts");
    writeFileSync(path, "// stub");
    expect(resolveEntry(workDir, "bot.ts")).toBe(path);
  });

  it("explicit --entry must exist or throw entry_not_found", () => {
    try {
      resolveEntry(workDir, "missing.ts");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("entry_not_found");
    }
  });

  it("falls back to package.json main", () => {
    writeFileSync(join(workDir, "package.json"), JSON.stringify({ main: "bot.mjs" }));
    const path = join(workDir, "bot.mjs");
    writeFileSync(path, "// stub");
    expect(resolveEntry(workDir)).toBe(path);
  });

  it("falls back to src/index.ts", () => {
    mkdirSync(join(workDir, "src"));
    const path = join(workDir, "src", "index.ts");
    writeFileSync(path, "// stub");
    expect(resolveEntry(workDir)).toBe(path);
  });

  it("falls back to index.ts at root", () => {
    const path = join(workDir, "index.ts");
    writeFileSync(path, "// stub");
    expect(resolveEntry(workDir)).toBe(path);
  });

  it("throws entry_not_found when nothing matches", () => {
    try {
      resolveEntry(workDir);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("entry_not_found");
    }
  });

  it("handles malformed package.json by falling through", () => {
    writeFileSync(join(workDir, "package.json"), "{ not valid json");
    mkdirSync(join(workDir, "src"));
    writeFileSync(join(workDir, "src", "index.ts"), "// stub");
    expect(resolveEntry(workDir)).toBe(join(workDir, "src", "index.ts"));
  });
});
