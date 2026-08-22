/**
 * Tests for scripts/check-subentry-consistency.mjs (B-101).
 *
 * A new `@theokit/sdk` sub-entry needs four coordinated edits: `package.json`
 * `exports`, `tsup.config.ts` `entry`, `tsconfig.tools-dts.json` `include`, and
 * `scripts/mirror-dts-to-cts.mjs` `targets`. Measured 2026-08-19: only the tsup
 * entry fails fast when missing; the other two silently ship a broken CJS types
 * condition that only `publint` catches, ~10 minutes into the pre-push chain.
 *
 * Verifies:
 *   - the REAL repo config (all 33 current sub-entries) passes with zero problems
 *   - a sub-entry declared ONLY in `package.json` `exports` — the "added it, and
 *     stopped" case — fails naming exactly the three still-missing places
 *   - an entry covered by tsup's native `dts.entry` path is exempt from the
 *     tsconfig/mirror checks (it needs neither)
 *   - a glob-covered tsconfig include (`"src/context/**\/*"`) satisfies coverage
 *     without a literal per-file entry
 *   - the CLI wrapper, invoked as a real subprocess against the real repo files,
 *     exits 0
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { checkSubentryConsistency } from "../scripts/check-subentry-consistency.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sdkRoot = resolve(__dirname, "..");
const script = resolve(sdkRoot, "scripts", "check-subentry-consistency.mjs");

function realFixture() {
  const pkg = JSON.parse(readFileSync(join(sdkRoot, "package.json"), "utf8"));
  const tsupSrc = readFileSync(join(sdkRoot, "tsup.config.ts"), "utf8");
  const tsconfigDts = JSON.parse(readFileSync(join(sdkRoot, "tsconfig.tools-dts.json"), "utf8"));
  const mirrorSrc = readFileSync(join(sdkRoot, "scripts", "mirror-dts-to-cts.mjs"), "utf8");
  return {
    exportsMap: pkg.exports as Record<string, unknown>,
    tsupSrc,
    tsconfigInclude: tsconfigDts.include as string[],
    mirrorSrc,
  };
}

describe("check-subentry-consistency — B-101", () => {
  it("test_the_real_repo_config_has_zero_sub_entry_disagreements", () => {
    const fixture = realFixture();
    const problems = checkSubentryConsistency(fixture);
    expect(problems).toEqual([]);
  });

  it("test_a_sub_entry_added_only_to_package_json_exports_fails_naming_the_three_remaining_files", () => {
    const fixture = realFixture();
    const exportsMap = {
      "./newthing": {
        import: { types: "./dist/newthing.d.ts", default: "./dist/newthing.js" },
        require: { types: "./dist/newthing.d.cts", default: "./dist/newthing.cjs" },
      },
    };

    const problems = checkSubentryConsistency({ ...fixture, exportsMap });

    expect(problems).toHaveLength(1);
    const [problem] = problems;
    if (problem === undefined) throw new Error("unreachable: length asserted above");
    expect(problem.exportPath).toBe("./newthing");
    expect(problem.entryKey).toBe("newthing");
    expect(problem.missing).toHaveLength(3);
    expect(problem.missing[0]).toMatch(/tsup\.config\.ts.*entry\["newthing"\]/);
    expect(problem.missing[1]).toMatch(/tsconfig\.tools-dts\.json.*include.*src\/newthing\.ts/);
    expect(problem.missing[2]).toMatch(/mirror-dts-to-cts\.mjs.*targets.*newthing\.d\.ts/);
  });

  it("test_an_entry_covered_by_tsups_native_dts_entry_is_exempt_from_tsconfig_and_mirror_checks", () => {
    const fixture = realFixture();
    // "cron" is a real dts.entry key (tsup.config.ts) — tsc/mirror coverage would
    // fail if required, since neither file mentions "src/cron.ts" or "cron.d.ts".
    const exportsMap = {
      "./cron": {
        import: { types: "./dist/cron.d.ts", default: "./dist/cron.js" },
        require: { types: "./dist/cron.d.cts", default: "./dist/cron.cjs" },
      },
    };

    const problems = checkSubentryConsistency({ ...fixture, exportsMap });
    expect(problems).toEqual([]);
  });

  it("test_a_glob_covering_tsconfig_include_satisfies_coverage_without_a_literal_entry", () => {
    const fixture = realFixture();
    // "context/index" is covered by the glob `"src/context/**/*"` in
    // tsconfig.tools-dts.json, not by a literal `"src/context/index.ts"` line.
    const exportsMap = {
      "./context": {
        import: { types: "./dist/context/index.d.ts", default: "./dist/context/index.js" },
        require: { types: "./dist/context/index.d.cts", default: "./dist/context/index.cjs" },
      },
    };

    const problems = checkSubentryConsistency({ ...fixture, exportsMap });
    expect(problems).toEqual([]);
  });

  it("test_missing_tsup_entry_alone_is_reported_without_a_false_tsconfig_or_mirror_complaint_when_those_are_present", () => {
    // "messages" IS covered by tsconfig.tools-dts.json + mirror-dts-to-cts.mjs
    // today. Blank out only the tsup entry text so ONLY the tsup complaint fires.
    const fixture = realFixture();
    const tsupSrcWithoutMessages = fixture.tsupSrc.replace('messages: "src/messages.ts",', "");
    expect(tsupSrcWithoutMessages).not.toBe(fixture.tsupSrc);

    const exportsMap = {
      "./messages": {
        import: { types: "./dist/messages.d.ts", default: "./dist/messages.js" },
        require: { types: "./dist/messages.d.cts", default: "./dist/messages.cjs" },
      },
    };

    const problems = checkSubentryConsistency({
      ...fixture,
      tsupSrc: tsupSrcWithoutMessages,
      exportsMap,
    });

    expect(problems).toHaveLength(1);
    const [problem] = problems;
    if (problem === undefined) throw new Error("unreachable: length asserted above");
    expect(problem.missing).toEqual([
      'tsup.config.ts: entry["messages"] (expected "src/messages.ts")',
    ]);
  });

  it("test_the_cli_wrapper_exits_zero_against_the_real_repo_files", () => {
    const result = spawnSync("node", [script], {
      cwd: sdkRoot,
      encoding: "utf-8",
      timeout: 10_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/sub-entry consistency: \d+ exports agree/);
  });
});
