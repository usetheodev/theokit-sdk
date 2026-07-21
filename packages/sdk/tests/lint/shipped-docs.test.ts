/**
 * Guard: the SDK reference docs actually ship in the npm tarball.
 *
 * `docs/` lives at the repo root (linked from the root README/CONTRIBUTING/
 * CLAUDE.md) but npm's `files` cannot reach outside the package, so `build`
 * copies it via `scripts/copy-docs.mjs`. Two ways that silently rots:
 *   1. `files` loses the `docs` entry -> tarball ships no docs.
 *   2. A new reference doc lands in root `docs/` but nobody adds it to the copy
 *      list -> it never reaches consumers.
 * This test fails on both. Static only (no build required).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PKG_ROOT = join(import.meta.dirname, "..", "..");
const REPO_ROOT = join(PKG_ROOT, "..", "..");

/** The repo-root docs/ nav page is intentionally repo-only (its links are repo-relative). */
const REPO_ONLY = new Set(["README.md"]);

function shippedDocList(): string[] {
  const script = readFileSync(join(PKG_ROOT, "scripts", "copy-docs.mjs"), "utf-8");
  const block = script.match(/const DOCS = \[([^\]]*)\]/);
  if (block?.[1] === undefined) throw new Error("copy-docs.mjs: could not parse the DOCS list");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1] as string).sort();
}

describe("shipped reference docs", () => {
  it("package.json `files` includes the docs directory", () => {
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf-8"));
    expect(pkg.files, "`docs` must be in files[] or the tarball ships no docs").toContain("docs");
  });

  it("build copies the docs (build script invokes copy-docs)", () => {
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf-8"));
    expect(pkg.scripts.build).toContain("copy-docs.mjs");
  });

  it("every root reference doc is on the shipped list (no silent omission)", () => {
    const rootDocs = readdirSync(join(REPO_ROOT, "docs"))
      .filter((f) => f.endsWith(".md") && !REPO_ONLY.has(f))
      .sort();
    expect(rootDocs.length).toBeGreaterThan(0);
    expect(shippedDocList()).toEqual(rootDocs);
  });
});
