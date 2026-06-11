import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DirectoryGuard } from "../../src/infra/directory-guard.js";

describe("DirectoryGuard", () => {
  const root = join(tmpdir(), "guard-test-" + Date.now());

  // Setup: create test directories
  const inner = join(root, "project");
  const outside = join(root, "outside");

  mkdirSync(inner, { recursive: true });
  mkdirSync(outside, { recursive: true });

  it("allows paths within project root", () => {
    const guard = new DirectoryGuard(inner);
    expect(guard.isAllowed(join(inner, "src", "index.ts"))).toBe(true);
  });

  it("allows the project root itself", () => {
    const guard = new DirectoryGuard(inner);
    expect(guard.isAllowed(inner)).toBe(true);
  });

  it("blocks paths outside project root", () => {
    const guard = new DirectoryGuard(inner);
    expect(guard.isAllowed(outside)).toBe(false);
  });

  it("blocks ../  traversal", () => {
    const guard = new DirectoryGuard(inner);
    expect(guard.isAllowed(join(inner, "..", "outside"))).toBe(false);
  });

  it("allows extra approved directories", () => {
    const guard = new DirectoryGuard(inner, [outside]);
    expect(guard.isAllowed(join(outside, "file.txt"))).toBe(true);
  });

  it("blocks symlink escape", () => {
    const linkPath = join(inner, "escape-link");
    try {
      symlinkSync(outside, linkPath);
      const guard = new DirectoryGuard(inner);
      expect(guard.isAllowed(join(linkPath, "secret.txt"))).toBe(false);
    } finally {
      rmSync(linkPath, { force: true });
    }
  });

  // Cleanup
  it("cleanup", () => {
    rmSync(root, { recursive: true, force: true });
  });
});
