/**
 * SDK 2.0 baseline artifact tests (Phase 0 / T0.1).
 *
 * Verifies that the pre-split snapshot files exist with the prescribed
 * structure, so diff comparison after extraction is possible.
 *
 * Pre-conditions for the baselines:
 *   - subsystems map: at least 17 numbered ## sections (one per subsystem)
 *   - bundle map: a table row per `exports` entry from packages/sdk/package.json
 *   - date-locked filename suffix `2026-06-07`
 *
 * See: docs/plans/sdk-2-0-package-split-plan.md § Phase 0.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Repository root = packages/sdk/tests/ → ../../..
const repoRoot = resolve(__dirname, "..", "..", "..");
const baselinesDir = resolve(repoRoot, ".claude", "knowledge-base", "baselines");

const subsystemsPath = resolve(baselinesDir, "sdk-2-0-baseline-subsystems-2026-06-07.md");

const bundlePath = resolve(baselinesDir, "sdk-2-0-baseline-bundle-2026-06-07.md");

describe("SDK 2.0 baseline artifacts (Phase 0 / T0.1)", () => {
  it("test_baseline_subsystems_md_exists — subsystems baseline file is on disk", () => {
    expect(existsSync(subsystemsPath)).toBe(true);
    const content = readFileSync(subsystemsPath, "utf-8");
    // Defend against an empty/frontmatter-only file slipping through.
    expect(content.length).toBeGreaterThan(1000);
  });

  it("test_baseline_subsystems_has_17_sections — at least 17 numbered subsystem sections (^## \\d+\\. matches)", () => {
    const content = readFileSync(subsystemsPath, "utf-8");
    const matches = content.match(/^## \d+\.\s/gm) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(17);
  });

  it("test_baseline_bundle_md_has_all_subpaths — bundle baseline lists every exports sub-path from package.json", () => {
    expect(existsSync(bundlePath)).toBe(true);
    const content = readFileSync(bundlePath, "utf-8");

    const pkg = JSON.parse(
      readFileSync(resolve(repoRoot, "packages", "sdk", "package.json"), "utf-8"),
    ) as { exports: Record<string, unknown> };

    const subpaths = Object.keys(pkg.exports);
    expect(subpaths.length).toBeGreaterThanOrEqual(11);

    for (const sub of subpaths) {
      // The doc may render a sub-path in a markdown code-span like `./cron`.
      // We require the literal sub-path string (between backticks OR plain)
      // to appear somewhere in the file.
      const found = content.includes(sub);
      expect(
        found,
        `sub-path ${sub} from package.json exports is missing from bundle baseline`,
      ).toBe(true);
    }
  });

  it("test_baseline_locked_dates — both baseline filenames are date-locked to 2026-06-07", () => {
    // Filename suffix invariant — proves baselines are time-anchored, not
    // re-measured silently on later runs.
    expect(subsystemsPath.endsWith("-2026-06-07.md")).toBe(true);
    expect(bundlePath.endsWith("-2026-06-07.md")).toBe(true);

    // Frontmatter `date:` field must match the filename suffix.
    const subContent = readFileSync(subsystemsPath, "utf-8");
    const bundleContent = readFileSync(bundlePath, "utf-8");
    expect(subContent).toMatch(/^date: 2026-06-07$/m);
    expect(bundleContent).toMatch(/^date: 2026-06-07$/m);
  });
});
