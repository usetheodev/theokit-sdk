/**
 * EC-C MUST FIX guard (edge-case review 2026-05-22).
 *
 * The published tarball MUST include the bundled `templates/` directory.
 * Without `"files": ["dist", "templates", ...]` in package.json, `npm
 * publish` ships only `dist/` and `npx @theokit/cli init` fails for
 * every consumer outside the monorepo.
 *
 * This test reads package.json and asserts the contract directly —
 * no need to actually run `pnpm pack` (slow + requires registry).
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

interface PackageJson {
  files?: string[];
}

describe("@theokit/cli published tarball contents (EC-C)", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as PackageJson;

  it("package.json declares a `files` array", () => {
    expect(Array.isArray(pkg.files)).toBe(true);
  });

  it("`files` includes `dist` (built JS + types)", () => {
    expect(pkg.files).toContain("dist");
  });

  it("`files` includes `templates` (init scaffolds)", () => {
    expect(pkg.files).toContain("templates");
  });

  it("`files` includes `README.md`", () => {
    expect(pkg.files).toContain("README.md");
  });
});
