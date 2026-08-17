/**
 * NPM publish-readiness gate for the SDK 2.0 extracted packages
 * (Phase 7 / T7.1 prep + Phase 10 / ADR D9 cohort gate).
 *
 * For each extracted package (@theokit/sdk-cache, @theokit/sdk-tools,
 * @theokit/sdk-handoff), verifies:
 *
 *   1. package.json has a name + version + license + repository.
 *   2. exports field declares `.` + `./package.json` (the bare-minimum
 *      conditions for ESM + CJS consumers + tooling).
 *   3. `dist/index.js` AND `dist/index.cjs` AND `dist/index.d.ts` AND
 *      `dist/index.d.cts` all exist on disk (proves the build emitted
 *      all 4 artifacts needed for full dual-package support).
 *   4. `sideEffects: false` declared (tree-shaking hint for bundlers —
 *      publint v0.3.21 specifically suggests this).
 *   5. No `workspace:*` references in `dependencies` or `peerDependencies`
 *      (those are replaced at publish time but should not leak into the
 *      installed manifest; only devDependencies may carry workspace:*).
 *   6. `files` array contains "dist" so the published tarball ships
 *      compiled artifacts.
 *
 * Does NOT run `pnpm publish` or `npm publish` — that requires npm auth
 * and a registry connection. Use `pnpm publint` + this test as the
 * sufficient pre-publish gate.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");

interface PackageJson {
  name?: string;
  version?: string;
  license?: string;
  type?: string;
  sideEffects?: boolean | string[];
  repository?: { type: string; url: string; directory?: string } | string;
  files?: string[];
  exports?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function readPackageJson(pkgName: string): PackageJson {
  const path = join(repoRoot, "packages", pkgName, "package.json");
  return JSON.parse(readFileSync(path, "utf-8")) as PackageJson;
}

const EXTRACTED_PACKAGES = ["sdk-cache", "sdk-tools", "sdk-handoff"] as const;

describe("SDK 2.0 extracted packages — npm publish readiness gate", () => {
  describe.each(EXTRACTED_PACKAGES)("@theokit/%s", (pkg) => {
    let manifest: PackageJson;

    beforeAll(() => {
      manifest = readPackageJson(pkg);
    });

    it("test_manifest_has_required_metadata", () => {
      expect(manifest.name).toBe(`@theokit/${pkg}`);
      expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(manifest.license).toBe("Apache-2.0");
      expect(manifest.type).toBe("module");
      expect(manifest.sideEffects).toBe(false);
    });

    it("test_repository_directory_pinned", () => {
      const repo = manifest.repository;
      expect(repo).toBeDefined();
      expect(typeof repo).toBe("object");
      if (typeof repo === "object" && repo !== null) {
        expect(repo.type).toBe("git");
        expect(repo.directory).toBe(`packages/${pkg}`);
      }
    });

    it("test_exports_field_has_dot_and_package_json", () => {
      expect(manifest.exports).toBeDefined();
      const exports = manifest.exports as Record<string, unknown>;
      expect(exports["."]).toBeDefined();
      expect(exports["./package.json"]).toBeDefined();
    });

    it("test_dist_artifacts_emit_dual_format", () => {
      const pkgDir = join(repoRoot, "packages", pkg);
      const artifacts = ["dist/index.js", "dist/index.cjs", "dist/index.d.ts", "dist/index.d.cts"];
      for (const a of artifacts) {
        const full = join(pkgDir, a);
        expect(existsSync(full), `${pkg}: missing ${a} — run 'pnpm build'`).toBe(true);
      }
    });

    it("test_files_array_ships_dist", () => {
      expect(Array.isArray(manifest.files)).toBe(true);
      expect(manifest.files).toContain("dist");
    });

    it("test_no_workspace_protocol_in_runtime_deps", () => {
      const runtimeDeps = {
        ...(manifest.dependencies ?? {}),
        ...(manifest.peerDependencies ?? {}),
      };
      for (const [name, range] of Object.entries(runtimeDeps)) {
        expect(
          range.startsWith("workspace:"),
          `${pkg}: ${name} uses workspace: protocol in non-dev deps — publish would leak this into the installed manifest`,
        ).toBe(false);
      }
    });

    it("test_peer_dep_on_theokit_sdk_uses_semver_range", () => {
      const peers = manifest.peerDependencies ?? {};
      expect(peers["@theokit/sdk"]).toBeDefined();
      // Must be a real semver range, not workspace: protocol.
      const range = peers["@theokit/sdk"] ?? "";
      expect(range).toMatch(/^[\^~>]?=?\d+\.\d+\.\d+/);
    });
  });
});

/**
 * The licence contract, over EVERY publishable package rather than a list.
 *
 * The gate above asserts `license === "Apache-2.0"` — and covered three packages while
 * the repository published twelve. `@theokit/sdk-pty@0.3.0` went to npm with no `license`
 * field at all and nothing reported it, because a hand-kept list stops covering a package
 * the moment someone adds one and forgets the list.
 *
 * Two halves, and both are needed. A manifest field with no file leaves a tarball
 * asserting Apache-2.0 while carrying none of its terms, and §4(a) requires a copy to
 * travel with every distribution. A file with no field leaves the tarball
 * all-rights-reserved to whoever installs it, because npm reads the field, not the
 * directory. Four packages listed `LICENSE` in `files` and shipped no such file — npm
 * omits a declared-but-absent path in silence, so neither `pnpm pack` nor publish said
 * a word.
 */
const publishablePackages = (): string[] =>
  readdirSync(join(repoRoot, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => existsSync(join(repoRoot, "packages", entry.name, "package.json")))
    .filter((entry) => {
      const manifest = readPackageJson(entry.name);
      return (manifest as { private?: boolean }).private !== true;
    })
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

describe("every publishable package conveys its licence", () => {
  const packages = publishablePackages();

  it("test_the_sweep_is_not_vacuous", () => {
    // A derived list that resolves to nothing passes every assertion below by having
    // none to make. That is the defect this block exists to remove, one level up.
    expect(packages.length, "no publishable package was discovered").toBeGreaterThan(0);
  });

  it.each(packages)("@theokit/%s declares and ships Apache-2.0", (pkg) => {
    const manifest = readPackageJson(pkg);

    expect(
      manifest.license,
      `${pkg}: no license field — the published tarball is all-rights-reserved to whoever installs it`,
    ).toBe("Apache-2.0");

    const licenseOnDisk = existsSync(join(repoRoot, "packages", pkg, "LICENSE"));
    expect(
      licenseOnDisk,
      `${pkg}: declares Apache-2.0 and ships no LICENSE file — §4(a) requires the terms to travel with the distribution`,
    ).toBe(true);

    if ((manifest.files ?? []).length > 0) {
      expect(
        manifest.files,
        `${pkg}: LICENSE exists but \`files\` does not list it, so npm leaves it out of the tarball`,
      ).toContain("LICENSE");
    }
  });
});

// Vitest globals — beforeAll lives at top-level when using auto-globals,
// but we import explicitly to keep the file lint-clean.
import { beforeAll } from "vitest";
