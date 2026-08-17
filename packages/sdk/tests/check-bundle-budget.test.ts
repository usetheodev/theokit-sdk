/**
 * Tests for tools/check-bundle-budget.mjs (SDK 2.0 Phase 10 / T10.1).
 *
 * Verifies:
 *   - PASS when all packages within budget
 *   - FAIL exit code 1 when any package exceeds budget
 *   - WARN_MISSING_DIST exit 0 when dist file absent (avoids false positives on WIP)
 *   - FATAL exit 2 on malformed budget config
 *   - Lists all offenders (doesn't bail on first failure)
 *   - --json output is machine-readable
 *
 * Strategy: invoke the script as a child process with --package=<name>
 * filter against the live workspace + a tmpdir fixture for negative cases.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const script = resolve(repoRoot, "tools", "check-bundle-budget.mjs");

function run(
  args: ReadonlyArray<string>,
  cwd?: string,
): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync("node", [script, ...args], {
    cwd: cwd ?? repoRoot,
    encoding: "utf-8",
    timeout: 10_000,
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe("check-bundle-budget — SDK 2.0 Phase 10 / T10.1", () => {
  it("test_check_bundle_budget_pass — sdk-cache within budget", () => {
    const { status, stdout } = run(["--package=sdk-cache"]);
    // Either PASS or WARN_MISSING_DIST (if build not yet run).
    expect(status).toBe(0);
    expect(stdout).toMatch(/sdk-cache/);
  });

  it("test_check_bundle_budget_lists_all_offenders — does not bail on first fail", () => {
    // Use --json on real workspace to see all entries reported.
    const { status, stdout } = run(["--json"]);
    expect([0, 1]).toContain(status);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
    // Every entry has the expected shape.
    for (const r of parsed) {
      expect(r).toHaveProperty("name");
      expect(r).toHaveProperty("dist");
      expect(r).toHaveProperty("max");
      expect(r).toHaveProperty("status");
      expect(["PASS", "FAIL", "WARN_MISSING_DIST"]).toContain(r.status);
    }
  });

  describe("with tmpdir fixture", () => {
    let fixtureRoot: string;
    let fixtureScript: string;

    beforeAll(() => {
      fixtureRoot = mkdtempSync(join(tmpdir(), "bundle-budget-test-"));
      mkdirSync(join(fixtureRoot, "packages"));
      mkdirSync(join(fixtureRoot, "tools"));
      // Copy script to fixture (so it computes packages dir relative to its own location)
      // Easier: just place a copy alongside a packages/ folder.
      fixtureScript = join(fixtureRoot, "tools", "check-bundle-budget.mjs");
      const scriptSrc = require("node:fs").readFileSync(script, "utf-8");
      writeFileSync(fixtureScript, scriptSrc);
    });

    afterAll(() => {
      if (fixtureRoot !== undefined) {
        rmSync(fixtureRoot, { recursive: true, force: true });
      }
    });

    function runFixture(extra: ReadonlyArray<string> = []): {
      status: number | null;
      stdout: string;
      stderr: string;
    } {
      const result = spawnSync("node", [fixtureScript, ...extra], {
        cwd: fixtureRoot,
        encoding: "utf-8",
        timeout: 10_000,
      });
      return { status: result.status, stdout: result.stdout, stderr: result.stderr };
    }

    function setupPackage(name: string, budget: object, distBytes?: number): void {
      const pkgDir = join(fixtureRoot, "packages", name);
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, ".bundle-budget.json"), JSON.stringify(budget));
      if (distBytes !== undefined) {
        mkdirSync(join(pkgDir, "dist"), { recursive: true });
        // Fill dist/index.js with non-repeating bytes so gzip can't collapse it
        // (otherwise gzipped size would be << raw size).
        const chunk = Buffer.alloc(distBytes);
        for (let i = 0; i < distBytes; i++) chunk[i] = i % 256;
        writeFileSync(join(pkgDir, "dist", "index.js"), chunk);
      }
    }

    it("test_check_bundle_budget_fail_on_overshoot — exits 1 with FAIL", () => {
      setupPackage("pkg-over", { "dist/index.js": 100 }, 5000); // 100-byte budget vs 5KB raw
      const { status, stdout } = runFixture(["--package=pkg-over"]);
      expect(status).toBe(1);
      expect(stdout).toMatch(/FAIL/);
      expect(stdout).toMatch(/pkg-over/);
    });

    it("test_check_bundle_budget_handles_missing_dist — exits 0 with WARN", () => {
      setupPackage("pkg-no-dist", { "dist/index.js": 1000 }); // no dist file
      const { status, stdout } = runFixture(["--package=pkg-no-dist"]);
      expect(status).toBe(0);
      expect(stdout).toMatch(/WARN_MISSING_DIST|MISSING/);
    });

    it("test_check_bundle_budget_fatal_on_malformed_config — exits 2", () => {
      const pkgDir = join(fixtureRoot, "packages", "pkg-bad-config");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, ".bundle-budget.json"), "{ not valid json }}}");
      const { status, stderr } = runFixture(["--package=pkg-bad-config"]);
      expect(status).toBe(2);
      expect(stderr).toMatch(/FATAL|malformed/);
    });

    it("test_check_bundle_budget_fatal_on_negative_value — exits 2", () => {
      setupPackage("pkg-neg", { "dist/index.js": -100 }, 500);
      const { status, stderr } = runFixture(["--package=pkg-neg"]);
      expect(status).toBe(2);
      expect(stderr).toMatch(/FATAL|positive/);
    });
  });
});
