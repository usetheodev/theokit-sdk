/**
 * M6-4 — `captureArtifact`: working-tree git diff + reverse apply-check.
 *
 * Drives the real `LocalSandbox` against a real temp git repo (no mocks). A
 * real edit yields a non-empty diff that reverse-applies cleanly; a clean tree
 * yields `{ diff: "", applies: false }`.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureArtifact } from "../../src/internal/eval/code-runner.js";
import { LocalSandbox } from "../../src/sandbox/local-sandbox.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

describe("captureArtifact (M6-4)", () => {
  let root: string;
  let repoDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "theo-artifact-"));
    repoDir = join(root, "repo");
    mkdirSync(repoDir);
    git(repoDir, "init", "--quiet");
    git(repoDir, "config", "user.email", "t@t.dev");
    git(repoDir, "config", "user.name", "tester");
    writeFileSync(join(repoDir, "README.md"), "hello\n");
    git(repoDir, "add", "README.md");
    git(repoDir, "commit", "--quiet", "-m", "initial");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns a non-empty diff that reverse-applies for a real edit", async () => {
    writeFileSync(join(repoDir, "README.md"), "hello world\n"); // uncommitted edit
    const sandbox = new LocalSandbox({ workDir: root });
    const { diff, applies } = await captureArtifact(sandbox, repoDir);
    expect(diff).toContain("hello world");
    expect(diff).toContain("README.md");
    expect(applies).toBe(true);
  });

  it("returns empty diff and applies false for a clean tree", async () => {
    const sandbox = new LocalSandbox({ workDir: root });
    const { diff, applies } = await captureArtifact(sandbox, repoDir);
    expect(diff).toBe("");
    expect(applies).toBe(false);
  });
});
