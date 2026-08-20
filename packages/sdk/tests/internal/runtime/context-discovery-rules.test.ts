/**
 * Discovery-integration tests for the `.theokit/rules/*.md` spec (T2).
 * Mirrors context-discovery.test.ts fixture conventions.
 */

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, onTestFinished } from "vitest";
import { runDiscovery } from "../../../src/internal/runtime/context/context-discovery-runner.js";
import { DEFAULT_MAX_BYTES_PER_FILE } from "../../../src/internal/runtime/context/context-loaders.js";
import { removeTempDirRobust } from "../../helpers/temp-workspace.js";

const SPEC_ID = "theokit-rules";

describe("discovery — .theokit/rules/*.md (T2)", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "theokit-rules-disc-"));
    const __tmpCleanup1 = tmp;
    onTestFinished(async () => {
      await removeTempDirRobust(__tmpCleanup1);
    });
    await mkdir(join(tmp, ".git"), { recursive: true });
    await mkdir(join(tmp, ".theokit", "rules"), { recursive: true });
    await writeFile(
      join(tmp, ".theokit", "rules", "always.md"),
      "---\nalwaysApply: true\n---\nUse tabs, not spaces.",
    );
    await writeFile(
      join(tmp, ".theokit", "rules", "api.md"),
      "---\npaths:\n  - src/api/**/*.ts\n---\nValidate every endpoint input.",
    );
  });

  const rulesSources = (sources: Array<{ id: string; content: string }>) =>
    sources.filter((s) => s.id.startsWith(SPEC_ID));

  it("discovers an alwaysApply rule with no in-scope files", async () => {
    const sources = await runDiscovery({ cwd: tmp, maxBytesPerFile: DEFAULT_MAX_BYTES_PER_FILE });
    const rules = rulesSources(sources);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.content).toContain("Use tabs, not spaces.");
  });

  it("does NOT activate a path-scoped rule when no in-scope files are declared", async () => {
    const sources = await runDiscovery({ cwd: tmp, maxBytesPerFile: DEFAULT_MAX_BYTES_PER_FILE });
    const bodies = rulesSources(sources).map((s) => s.content);
    expect(bodies.some((b) => b.includes("Validate every endpoint input."))).toBe(false);
  });

  it("activates the path-scoped rule when a matching in-scope file is declared", async () => {
    const sources = await runDiscovery({
      cwd: tmp,
      maxBytesPerFile: DEFAULT_MAX_BYTES_PER_FILE,
      touchedFiles: ["src/api/users.ts"],
    });
    const bodies = rulesSources(sources).map((s) => s.content);
    expect(bodies.some((b) => b.includes("Validate every endpoint input."))).toBe(true);
    // alwaysApply rule still present
    expect(bodies.some((b) => b.includes("Use tabs, not spaces."))).toBe(true);
  });

  it("does NOT activate the path-scoped rule for a non-matching in-scope file", async () => {
    const sources = await runDiscovery({
      cwd: tmp,
      maxBytesPerFile: DEFAULT_MAX_BYTES_PER_FILE,
      touchedFiles: ["src/ui/button.tsx"],
    });
    const bodies = rulesSources(sources).map((s) => s.content);
    expect(bodies.some((b) => b.includes("Validate every endpoint input."))).toBe(false);
  });

  it("the same in-scope signal also activates .cursor/rules/*.mdc globs (cross-format)", async () => {
    await mkdir(join(tmp, ".cursor", "rules"), { recursive: true });
    await writeFile(
      join(tmp, ".cursor", "rules", "ts.mdc"),
      "---\nalwaysApply: false\nglobs:\n  - src/**/*.ts\n---\nPrefer const.",
    );

    const dormant = await runDiscovery({ cwd: tmp, maxBytesPerFile: DEFAULT_MAX_BYTES_PER_FILE });
    expect(dormant.some((s) => s.content.includes("Prefer const."))).toBe(false);

    const active = await runDiscovery({
      cwd: tmp,
      maxBytesPerFile: DEFAULT_MAX_BYTES_PER_FILE,
      touchedFiles: ["src/api/users.ts"],
    });
    expect(active.some((s) => s.content.includes("Prefer const."))).toBe(true);
  });
});
