/**
 * T5.1 — multi-format context discovery integration.
 */

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, onTestFinished } from "vitest";
import { FileContextManager } from "../../../src/internal/runtime/context/context-manager.js";
import { removeTempDirRobust } from "../../helpers/temp-workspace.js";

async function buildRepo(): Promise<string> {
  const tmp = await mkdtemp(join(tmpdir(), "theokit-ctx-integration-"));
  const __tmpCleanup1 = tmp;
  onTestFinished(async () => {
    await removeTempDirRobust(__tmpCleanup1);
  });
  await mkdir(join(tmp, ".git"), { recursive: true });
  return tmp;
}

describe("FileContextManager multi-format discovery (T5.1)", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await buildRepo();
  });

  it("AGENTS.md at cwd discovered", async () => {
    await writeFile(join(tmp, "AGENTS.md"), "agents content");
    const mgr = new FileContextManager(tmp, { manager: "file" }, true);
    await mgr.initialize();
    const snap = await mgr.snapshot();
    expect(snap.sources.some((s) => s.name === "AGENTS.md")).toBe(true);
  });

  it("CLAUDE.md walk up to git root discovered", async () => {
    await writeFile(join(tmp, "CLAUDE.md"), "claude content");
    await mkdir(join(tmp, "packages", "deep"), { recursive: true });
    const mgr = new FileContextManager(join(tmp, "packages", "deep"), { manager: "file" }, true);
    await mgr.initialize();
    const snap = await mgr.snapshot();
    expect(snap.sources.some((s) => s.name === "CLAUDE.md")).toBe(true);
  });

  it("GEMINI.md with @import resolved", async () => {
    await writeFile(join(tmp, "GEMINI.md"), "gemini\n@imported.md\nend");
    await writeFile(join(tmp, "imported.md"), "IMPORTED");
    const mgr = new FileContextManager(tmp, { manager: "file" }, true);
    await mgr.initialize();
    const snap = await mgr.snapshot();
    const usedTokens = snap.budget?.usedTokens;
    const tokens = Array.isArray(usedTokens) ? usedTokens.join("\n") : "";
    expect(tokens).toContain("IMPORTED");
  });

  it("cursor rules mdc with alwaysApply included", async () => {
    await mkdir(join(tmp, ".cursor", "rules"), { recursive: true });
    await writeFile(
      join(tmp, ".cursor", "rules", "always.mdc"),
      "---\nalwaysApply: true\n---\nALWAYS_RULE_BODY",
    );
    const mgr = new FileContextManager(tmp, { manager: "file" }, true);
    await mgr.initialize();
    const snap = await mgr.snapshot();
    const usedTokens = snap.budget?.usedTokens;
    const tokens = Array.isArray(usedTokens) ? usedTokens.join("\n") : "";
    expect(tokens).toContain("ALWAYS_RULE_BODY");
  });

  it("THEO.md in .theokit discovered", async () => {
    await mkdir(join(tmp, ".theokit"), { recursive: true });
    await writeFile(join(tmp, ".theokit", "THEO.md"), "THEO_BODY");
    const mgr = new FileContextManager(tmp, { manager: "file" }, true);
    await mgr.initialize();
    const snap = await mgr.snapshot();
    expect(snap.sources.some((s) => s.name === "THEO.md")).toBe(true);
  });

  it("merge order is priority ascending (EC-27)", async () => {
    await writeFile(join(tmp, "AGENTS.md"), "agents");
    await writeFile(join(tmp, "CLAUDE.md"), "claude");
    await mkdir(join(tmp, ".theokit"), { recursive: true });
    await writeFile(join(tmp, ".theokit", "THEO.md"), "theo");
    const mgr = new FileContextManager(tmp, { manager: "file" }, true);
    await mgr.initialize();
    const snap = await mgr.snapshot();
    const names = snap.sources.map((s) => s.name);
    expect(names.indexOf("AGENTS.md")).toBeLessThan(names.indexOf("CLAUDE.md"));
    expect(names.indexOf("CLAUDE.md")).toBeLessThan(names.indexOf("THEO.md"));
  });

  // EC-E privacy: disambiguation NEVER includes absolute paths
  it("EC-E: nested AGENTS.md disambiguated by relative-to-git-root path, NEVER absolute", async () => {
    await writeFile(join(tmp, "AGENTS.md"), "root");
    await mkdir(join(tmp, "packages", "foo"), { recursive: true });
    await writeFile(join(tmp, "packages", "foo", "AGENTS.md"), "nested");
    const mgr = new FileContextManager(join(tmp, "packages", "foo"), { manager: "file" }, true);
    await mgr.initialize();
    const snap = await mgr.snapshot();
    const names = snap.sources.map((s) => s.name);
    // One unqualified + one with relative path qualifier
    expect(names.some((n) => n === "AGENTS.md")).toBe(true);
    expect(names.some((n) => n === "AGENTS.md@packages/foo")).toBe(true);
    // No absolute paths in ANY name
    for (const name of names) {
      expect(name).not.toContain(tmp);
      expect(name.includes("/home/") || name.includes("/Users/")).toBe(false);
    }
  });

  it("disambiguation never includes absolute path (EC-E grep)", async () => {
    await writeFile(join(tmp, "AGENTS.md"), "root");
    await mkdir(join(tmp, "sub"), { recursive: true });
    await writeFile(join(tmp, "sub", "AGENTS.md"), "sub");
    const mgr = new FileContextManager(join(tmp, "sub"), { manager: "file" }, true);
    await mgr.initialize();
    const snap = await mgr.snapshot();
    for (const s of snap.sources) {
      expect(s.name.startsWith("/")).toBe(false);
      expect(s.name).not.toMatch(/@\/.*/);
    }
  });

  it("disambiguation uses git-root-relative, not cwd-relative", async () => {
    await writeFile(join(tmp, "AGENTS.md"), "root");
    await mkdir(join(tmp, "packages", "a", "src"), { recursive: true });
    await writeFile(join(tmp, "packages", "a", "AGENTS.md"), "pkg-a");
    const mgr = new FileContextManager(
      join(tmp, "packages", "a", "src"),
      { manager: "file" },
      true,
    );
    await mgr.initialize();
    const snap = await mgr.snapshot();
    // Names use paths relative to git-root (tmp), not to cwd (src/).
    expect(snap.sources.some((s) => s.name === "AGENTS.md@packages/a")).toBe(true);
  });

  it("symlink dedup via realpath (EC-F)", async () => {
    await writeFile(join(tmp, "AGENTS.md"), "real");
    // EC-F is tested in context-discovery.test.ts; integration sees one entry.
    const mgr = new FileContextManager(tmp, { manager: "file" }, true);
    await mgr.initialize();
    const snap = await mgr.snapshot();
    const agentSources = snap.sources.filter((s) => s.name === "AGENTS.md");
    expect(agentSources.length).toBe(1);
  });

  it("no files anywhere yields no AGENTS/CLAUDE/THEO sources (EC-26)", async () => {
    const mgr = new FileContextManager(tmp, { manager: "file" }, true);
    await mgr.initialize();
    const snap = await mgr.snapshot();
    expect(snap.sources.some((s) => s.name === "AGENTS.md")).toBe(false);
    expect(snap.sources.some((s) => s.name === "CLAUDE.md")).toBe(false);
    expect(snap.sources.some((s) => s.name === "THEO.md")).toBe(false);
  });
});
