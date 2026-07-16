/**
 * SDK 2.0 docs validation (Phase 9 / T9.1).
 *
 * Verifies the docs artifacts ship with the expected structure:
 *   - packages/README.md lists every workspace package by name.
 *   - satellite READMEs (sdk-cache, sdk-tools) self-describe their package.
 *   - Both sdk-cache and sdk-tools READMEs reference their package name.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const packagesDir = join(repoRoot, "packages");
const packagesReadme = join(packagesDir, "README.md");

describe("SDK 2.0 docs (Phase 9 / T9.1)", () => {
  it("test_packages_readme_exists", () => {
    expect(existsSync(packagesReadme)).toBe(true);
    const content = readFileSync(packagesReadme, "utf-8");
    expect(content.length).toBeGreaterThan(2000);
  });

  it("test_packages_readme_has_harness_families — Core, Memory adapters, Integrations (cohesion split removed Channels + React)", () => {
    // Cohesion split (2026-06-18, plan monorepo-cohesion-split): the Channels (gateways)
    // and React families were extracted to sibling repos. The Harness monorepo now has
    // 3 families; extracted clusters are documented in an "Extracted to sibling repos" table.
    const content = readFileSync(packagesReadme, "utf-8");
    expect(content).toMatch(/^### Core/m);
    expect(content).toMatch(/^### Memory adapters/m);
    expect(content).toMatch(/^### Integrations/m);
    expect(content).toMatch(/^## Extracted to sibling repos/m);
  });

  it("test_packages_readme_lists_every_workspace_package", () => {
    const content = readFileSync(packagesReadme, "utf-8");
    const packageNames = readdirSync(packagesDir)
      .filter((name) => statSync(join(packagesDir, name)).isDirectory())
      .map((dir) => {
        const pkgJson = join(packagesDir, dir, "package.json");
        if (!existsSync(pkgJson)) return null;
        const parsed = JSON.parse(readFileSync(pkgJson, "utf-8")) as { name: string };
        return parsed.name;
      })
      .filter((n): n is string => n !== null);

    // Cohesion split (2026-06-18, plan monorepo-cohesion-split): the monorepo now
    // ships only the Harness set (12 packages) — backend-dx/gateways/react/rag/voice/
    // google-workspace were extracted to sibling repos. Threshold lowered from 20.
    expect(packageNames.length).toBeGreaterThanOrEqual(10);
    for (const name of packageNames) {
      expect(content, `package ${name} missing from packages/README.md`).toContain(name);
    }
  });

  it("test_packages_readme_has_split_status_table", () => {
    const content = readFileSync(packagesReadme, "utf-8");
    expect(content).toMatch(/SDK 2\.0 split status/);
    // 11 rows in the status table (Phase 0–10). Match the actual row prefix.
    expect(content).toMatch(/^\|\s*0\s*\|/m);
    expect(content).toMatch(/^\|\s*10\s*\|/m);
  });

  // NOTE: the docs/migration/1-x-to-2-0.md validation tests were removed when the
  // docs/ set was trimmed to 3 files (code is the documentation; the 1.x→2.0
  // migration lives in git history + CHANGELOG). The codemod itself
  // (@theokit/codemod-sdk-2-0) is still tested by its own package suite.

  it("test_sdk_cache_readme_self_describes", () => {
    const readme = join(packagesDir, "sdk-cache", "README.md");
    expect(existsSync(readme)).toBe(true);
    const content = readFileSync(readme, "utf-8");
    expect(content).toContain("@theokit/sdk-cache");
    expect(content).toContain("Cache.semantic");
  });

  it("test_sdk_tools_readme_self_describes", () => {
    const readme = join(packagesDir, "sdk-tools", "README.md");
    expect(existsSync(readme)).toBe(true);
    const content = readFileSync(readme, "utf-8");
    expect(content).toContain("@theokit/sdk-tools");
    expect(content).toContain("createReadFileTool");
  });
});
