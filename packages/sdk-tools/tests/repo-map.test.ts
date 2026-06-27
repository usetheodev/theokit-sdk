import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildEnvContext, buildRepoMap, type EnvContextOptions } from "../src/internal/repo-map.js";

// Probe symlink capability once so the EC-1 test reports SKIPPED (not a silent
// green) on platforms/sandboxes that deny symlink creation.
const SYMLINKS_OK = (() => {
  try {
    const d = mkdtempSync(join(tmpdir(), "sdk-symprobe-"));
    symlinkSync(d, join(d, "l"), "dir");
    rmSync(d, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
})();

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

  it.skipIf(!SYMLINKS_OK)("does not follow a directory symlink loop (EC-1)", () => {
    mkdirSync(join(root, "real"));
    symlinkSync(root, join(root, "loop"), "dir");
    const out = buildRepoMap(root, { maxDepth: 6 });
    // Structural invariant: the symlink is a LEAF (no trailing slash, not descended).
    // A symlink-following walker would re-list `real/` under `loop/` repeatedly.
    expect(out).toContain("loop");
    expect(out).not.toContain("loop/");
    expect(out.match(/real/g)?.length).toBe(1);
  });

  it("returns unavailable when cwd is a file, not a directory", () => {
    writeFileSync(join(root, "f.txt"), "x");
    expect(buildRepoMap(join(root, "f.txt"))).toContain("unavailable");
  });

  it("elides over-cap entries with a '(N more)' marker", () => {
    for (let i = 0; i < 250; i++)
      writeFileSync(join(root, `f-${String(i).padStart(3, "0")}.txt`), "x");
    const out = buildRepoMap(root, { budget: 100_000 });
    expect(out).toContain("(50 more)");
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

describe("buildEnvContext — git branch + injectable clock (RADAR #92.b)", () => {
  it("shows the branch when .git/HEAD points at a ref", () => {
    const headPath = join(root, "HEAD");
    writeFileSync(headPath, "ref: refs/heads/feature/cool-thing\n");
    const out = buildEnvContext(root, { gitHeadPath: headPath });
    expect(out).toContain("Branch: feature/cool-thing");
  });

  it("omits the branch for a detached HEAD (no ref line)", () => {
    const headPath = join(root, "HEAD");
    writeFileSync(headPath, "9fceb02d0ae598e95dc970b74767f19372d61af8\n");
    const out = buildEnvContext(root, { gitHeadPath: headPath });
    expect(out).not.toContain("Branch:");
  });

  it("omits the branch when the HEAD file is unreadable / missing", () => {
    const out = buildEnvContext(root, { gitHeadPath: join(root, "does-not-exist") });
    expect(out).not.toContain("Branch:");
  });

  it("defaults gitHeadPath to <cwd>/.git/HEAD", () => {
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
    const out = buildEnvContext(root);
    expect(out).toContain("Branch: main");
  });

  it("uses the injected clock for the date line (deterministic)", () => {
    const fixed = new Date("2030-01-02T03:04:05Z");
    const opts: EnvContextOptions = { now: fixed };
    const out = buildEnvContext(root, opts);
    expect(out).toContain(fixed.toDateString());
  });

  it("backward-compatible: no opts still produces the env block", () => {
    const out = buildEnvContext(root);
    expect(out).toContain("<env>");
    expect(out).toContain(root);
  });
});

describe("sdk-tools barrel — repo-map builders", () => {
  it("re-exports buildEnvContext and buildRepoMap", async () => {
    const mod = await import("../src/index.js");
    expect(typeof mod.buildEnvContext).toBe("function");
    expect(typeof mod.buildRepoMap).toBe("function");
  });
});
