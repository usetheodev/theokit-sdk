import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, onTestFinished } from "vitest";
import { DEFAULT_DISCOVERY_SPECS, runDiscovery } from "../src/context/index.js";
import { removeTempDirRobustSync } from "./helpers/temp-workspace.js";

/*
 * Rules written for the Claude Code CLI.
 *
 * Measured 2026-08-26 over the 32 rule files in this repository's `.claude/rules`: NONE carries
 * frontmatter — they are plain markdown. The `rules-frontmatter` parser already treats a file with
 * no frontmatter as `alwaysApply: true`, so the format needed nothing; there was simply no spec
 * pointing at the directory.
 *
 * Priority 46 puts it immediately after `.theokit/rules` (45): specs sort ascending and the tail is
 * what a context budget drops first, so the explicit namespace survives a squeeze that the borrowed
 * one does not.
 */
describe("rules under .claude", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "cc-rules-compat-"));
    onTestFinished(() => {
      removeTempDirRobustSync(cwd);
    });
  });

  const discover = async (): Promise<{ id: string; content: string }[]> =>
    (await runDiscovery({ cwd, specs: DEFAULT_DISCOVERY_SPECS, maxBytesPerFile: 64_000 })) as never;

  it("test_a_plain_markdown_rule_under_dot_claude_is_discovered", async () => {
    mkdirSync(join(cwd, ".claude", "rules"), { recursive: true });
    writeFileSync(
      join(cwd, ".claude", "rules", "testing.md"),
      "# Testing\n\nThe code is RULE-7777.\n",
    );
    // A globbed spec reports its id suffixed with the directory it matched.
    const found = await discover();
    const rule = found.find((f) => f.id.startsWith("claude-rules"));
    expect(rule).toBeDefined();
    expect(rule?.content).toContain("RULE-7777");
  });

  it("test_it_sits_after_the_explicit_namespace_in_the_budget_order", () => {
    const claude = DEFAULT_DISCOVERY_SPECS.find((s) => s.id === "claude-rules");
    const theokit = DEFAULT_DISCOVERY_SPECS.find((s) => s.id === "theokit-rules");
    expect(claude?.priority).toBeGreaterThan(theokit?.priority as number);
  });

  // The accepted case in the other direction (rules/testing.md § 4.2): adding the spec must not
  // make a project WITHOUT the directory start reporting a source it does not have.
  it("test_a_project_with_no_dot_claude_rules_discovers_none", async () => {
    writeFileSync(join(cwd, "CLAUDE.md"), "# Project\n");
    const found = await discover();
    expect(found.filter((f) => f.id.startsWith("claude-rules"))).toEqual([]);
  });
});
