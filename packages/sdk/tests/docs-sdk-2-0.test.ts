/**
 * SDK 2.0 docs validation (Phase 9 / T9.1).
 *
 * Verifies the docs artifacts ship with the expected structure:
 *   - packages/README.md lists every workspace package by name.
 *   - docs/migration/1-x-to-2-0.md has the codemod snippet + before/after pairs.
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
const migrationGuide = join(repoRoot, "docs", "migration", "1-x-to-2-0.md");

describe("SDK 2.0 docs (Phase 9 / T9.1)", () => {
  it("test_packages_readme_exists", () => {
    expect(existsSync(packagesReadme)).toBe(true);
    const content = readFileSync(packagesReadme, "utf-8");
    expect(content.length).toBeGreaterThan(2000);
  });

  it("test_packages_readme_has_5_families — families table includes Core, Channels, Memory adapters, React, Integrations", () => {
    const content = readFileSync(packagesReadme, "utf-8");
    expect(content).toMatch(/^### Core/m);
    expect(content).toMatch(/^### Channels/m);
    expect(content).toMatch(/^### Memory adapters/m);
    expect(content).toMatch(/^### React/m);
    expect(content).toMatch(/^### Integrations/m);
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

    expect(packageNames.length).toBeGreaterThanOrEqual(20);
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

  it("test_migration_guide_exists", () => {
    expect(existsSync(migrationGuide)).toBe(true);
    const content = readFileSync(migrationGuide, "utf-8");
    expect(content.length).toBeGreaterThan(2000);
  });

  it("test_migration_guide_has_codemod_snippet", () => {
    const content = readFileSync(migrationGuide, "utf-8");
    expect(content).toMatch(/jscodeshift -t.*1-x-to-2-0\.cjs/);
  });

  it("test_migration_guide_has_before_after_blocks — at least 4 diff blocks", () => {
    const content = readFileSync(migrationGuide, "utf-8");
    // Count fenced diff/typescript blocks
    const diffBlocks = content.match(/```diff[\s\S]*?```/g) ?? [];
    expect(diffBlocks.length).toBeGreaterThanOrEqual(4);
  });

  it("test_migration_guide_documents_budget_silent_break", () => {
    const content = readFileSync(migrationGuide, "utf-8");
    expect(content).toMatch(/budgetTracker/i);
    expect(content).toMatch(/silent.*break|silent.*change/i);
  });

  it("test_migration_guide_documents_handoff_removal", () => {
    const content = readFileSync(migrationGuide, "utf-8");
    expect(content).toMatch(/Handoff\.asPlugin/);
    expect(content).toMatch(/handoffs.*removed/i);
  });

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
