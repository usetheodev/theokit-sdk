import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildEnvContext, buildRepoMap } from "../src/internal/repo-map.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sdk-repomap-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("buildRepoMap — tree listing", () => {
  it("lists directories and files under cwd", () => {
    mkdirSync(join(root, "a"));
    writeFileSync(join(root, "b.txt"), "x");
    const out = buildRepoMap(root);
    expect(out).toContain("a");
    expect(out).toContain("b.txt");
  });

  it("excludes default-ignored dirs (node_modules, .git)", () => {
    mkdirSync(join(root, "node_modules"));
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, "keep.txt"), "x");
    const out = buildRepoMap(root);
    expect(out).toContain("keep.txt");
    expect(out).not.toContain("node_modules");
    expect(out).not.toContain(".git");
  });

  it("excludes caller-supplied ignore entries", () => {
    mkdirSync(join(root, "foo"));
    mkdirSync(join(root, "bar"));
    const out = buildRepoMap(root, { ignore: ["foo"] });
    expect(out).not.toContain("foo");
    expect(out).toContain("bar");
  });

  it("honors the char budget with a truncation marker", () => {
    for (let i = 0; i < 200; i++) writeFileSync(join(root, `file-${i}.txt`), "x");
    const out = buildRepoMap(root, { budget: 200 });
    expect(out.length).toBeLessThan(600);
    expect(out).toContain("truncated");
  });

  it("honors maxDepth (deep entries omitted)", () => {
    mkdirSync(join(root, "lvl1", "lvl2", "lvl3"), { recursive: true });
    writeFileSync(join(root, "lvl1", "lvl2", "lvl3", "deep.txt"), "x");
    const out = buildRepoMap(root, { maxDepth: 1 });
    expect(out).toContain("lvl1");
    expect(out).not.toContain("deep.txt");
  });

  it("does not follow a directory symlink loop (EC-1)", () => {
    mkdirSync(join(root, "real"));
    try {
      symlinkSync(root, join(root, "loop"), "dir");
    } catch {
      return; // platform without symlink permission — skip
    }
    const out = buildRepoMap(root, { maxDepth: 6 });
    expect(typeof out).toBe("string");
    expect(out).toContain("real");
  });

  it("truncation is line-clean and ends with the marker (EC-2)", () => {
    for (let i = 0; i < 100; i++) writeFileSync(join(root, `entry-${i}.txt`), "x");
    const out = buildRepoMap(root, { budget: 120 });
    expect(out.trimEnd().endsWith("(truncated)")).toBe(true);
  });

  it("never throws on a missing cwd", () => {
    expect(() => buildRepoMap("/no/such/dir-xyz")).not.toThrow();
    expect(buildRepoMap("/no/such/dir-xyz")).toContain("unavailable");
  });
});

describe("buildEnvContext — env block", () => {
  it("contains the core fields (cwd, platform, date)", () => {
    const out = buildEnvContext(root);
    expect(out).toContain(root);
    expect(out).toContain("Platform");
    expect(out).toContain("date");
  });

  it("detects whether the directory is a git repo", () => {
    expect(buildEnvContext(root)).toContain("git repo: no");
    mkdirSync(join(root, ".git"));
    expect(buildEnvContext(root)).toContain("git repo: yes");
  });

  it("surfaces a project doc when present (README.md)", () => {
    writeFileSync(join(root, "README.md"), "# My Project\nhello");
    const out = buildEnvContext(root);
    expect(out).toContain("README.md");
  });

  it("never throws on a missing cwd", () => {
    expect(() => buildEnvContext("/no/such/dir-xyz")).not.toThrow();
    expect(typeof buildEnvContext("/no/such/dir-xyz")).toBe("string");
  });
});

describe("sdk-tools barrel — repo-map builders", () => {
  it("re-exports buildEnvContext and buildRepoMap", async () => {
    const mod = await import("../src/index.js");
    expect(typeof mod.buildEnvContext).toBe("function");
    expect(typeof mod.buildRepoMap).toBe("function");
  });
});
