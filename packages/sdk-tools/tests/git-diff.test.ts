import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createGitDiffTool } from "../src/git-diff.js";

let projectRoot: string;

function initRepo(): void {
  execSync("git init --quiet", { cwd: projectRoot });
  execSync('git config user.email "test@example.com"', { cwd: projectRoot });
  execSync('git config user.name "Test"', { cwd: projectRoot });
  execSync("git config commit.gpgsign false", { cwd: projectRoot });
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "sdk-gitdiff-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("createGitDiffTool — tool shape", () => {
  it("Given the factory, Then it returns a CustomTool with name='git_diff'", () => {
    const tool = createGitDiffTool({ projectRoot });
    expect(tool.name).toBe("git_diff");
    expect(typeof tool.handler).toBe("function");
  });
});

describe("createGitDiffTool — happy path", () => {
  it("Given a tracked file with unstaged changes, When git_diff is invoked, Then diff text is returned", async () => {
    initRepo();
    writeFileSync(join(projectRoot, "file.txt"), "original\n");
    execSync("git add -A", { cwd: projectRoot });
    execSync("git commit -m init --quiet", { cwd: projectRoot });
    writeFileSync(join(projectRoot, "file.txt"), "modified\n");

    const tool = createGitDiffTool({ projectRoot });
    const out = await tool.handler({});
    const parsed = JSON.parse(out) as { ok: boolean; diff: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.diff).toContain("-original");
    expect(parsed.diff).toContain("+modified");
  });

  it("Given no changes, When git_diff is invoked, Then diff is empty string", async () => {
    initRepo();
    writeFileSync(join(projectRoot, "file.txt"), "clean\n");
    execSync("git add -A", { cwd: projectRoot });
    execSync("git commit -m init --quiet", { cwd: projectRoot });

    const tool = createGitDiffTool({ projectRoot });
    const out = await tool.handler({});
    const parsed = JSON.parse(out) as { ok: boolean; diff: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.diff).toBe("");
  });

  it("Given a path scope, Then only that file's diff is returned", async () => {
    initRepo();
    writeFileSync(join(projectRoot, "a.txt"), "a-old\n");
    writeFileSync(join(projectRoot, "b.txt"), "b-old\n");
    execSync("git add -A", { cwd: projectRoot });
    execSync("git commit -m init --quiet", { cwd: projectRoot });
    writeFileSync(join(projectRoot, "a.txt"), "a-new\n");
    writeFileSync(join(projectRoot, "b.txt"), "b-new\n");

    const tool = createGitDiffTool({ projectRoot });
    const out = await tool.handler({ path: "a.txt" });
    const parsed = JSON.parse(out) as { diff: string };
    expect(parsed.diff).toContain("a-old");
    expect(parsed.diff).not.toContain("b-old");
  });
});

describe("createGitDiffTool — staged + cached flag", () => {
  it("Given staged changes + cached=true, Then staged diff is returned", async () => {
    initRepo();
    writeFileSync(join(projectRoot, "file.txt"), "original\n");
    execSync("git add -A", { cwd: projectRoot });
    execSync("git commit -m init --quiet", { cwd: projectRoot });
    writeFileSync(join(projectRoot, "file.txt"), "staged\n");
    execSync("git add file.txt", { cwd: projectRoot });

    const tool = createGitDiffTool({ projectRoot });
    const out = await tool.handler({ cached: true });
    const parsed = JSON.parse(out) as { diff: string };
    expect(parsed.diff).toContain("+staged");
  });
});

describe("createGitDiffTool — safety boundaries", () => {
  it("Given path traversal in scope, Then error='path_traversal'", async () => {
    initRepo();
    const tool = createGitDiffTool({ projectRoot });
    const out = await tool.handler({ path: "../etc/passwd" });
    const parsed = JSON.parse(out) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("path_traversal");
  });

  it("Given a non-git directory, Then error='not_a_repo'", async () => {
    // No initRepo() — projectRoot has no .git
    const tool = createGitDiffTool({ projectRoot });
    const out = await tool.handler({});
    const parsed = JSON.parse(out) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("not_a_repo");
  });
});
