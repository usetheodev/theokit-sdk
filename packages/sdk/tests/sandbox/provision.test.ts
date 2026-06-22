/**
 * M6-3 — `provisionRepo` over `SandboxBackend.execute`.
 *
 * Drives the real `LocalSandbox` against a real temp git repository (no mocks):
 * clone + checkout a ref into an isolated dir, typed `RepoProvisionError` on
 * git failure. Per ADR D2 the provisioner rides `execute`, never `child_process`.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalSandbox } from "../../src/sandbox/local-sandbox.js";
import { provisionRepo, RepoProvisionError } from "../../src/sandbox/provision.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

describe("provisionRepo (M6-3)", () => {
  let root: string;
  let source: string;
  let work: string;
  let headSha: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "theo-provision-"));
    source = join(root, "source");
    work = join(root, "work");
    mkdirSync(source);
    mkdirSync(work);
    git(source, "init", "--quiet");
    git(source, "config", "user.email", "t@t.dev");
    git(source, "config", "user.name", "tester");
    writeFileSync(join(source, "README.md"), "hello\n");
    git(source, "add", "README.md");
    git(source, "commit", "--quiet", "-m", "initial");
    headSha = git(source, "rev-parse", "HEAD");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("clones and checks out a ref into an isolated dir", async () => {
    const sandbox = new LocalSandbox({ workDir: work });
    const { repoDir } = await provisionRepo(sandbox, {
      repoUrl: source,
      ref: headSha,
      instanceId: "inst-1",
    });
    expect(repoDir).toBe(join(realpathSync(work), "inst-1"));
    expect(existsSync(join(repoDir, "README.md"))).toBe(true);
    expect(git(repoDir, "rev-parse", "HEAD")).toBe(headSha);
  });

  it("throws RepoProvisionError naming the instanceId on a bad ref", async () => {
    const sandbox = new LocalSandbox({ workDir: work });
    await expect(
      provisionRepo(sandbox, {
        repoUrl: source,
        ref: "0000000000000000000000000000000000000000",
        instanceId: "inst-bad-ref",
      }),
    ).rejects.toMatchObject({ name: "RepoProvisionError", instanceId: "inst-bad-ref" });
  });

  it("throws RepoProvisionError on a nonexistent repo", async () => {
    const sandbox = new LocalSandbox({ workDir: work });
    await expect(
      provisionRepo(sandbox, {
        repoUrl: join(root, "does-not-exist"),
        ref: "HEAD",
        instanceId: "inst-x",
      }),
    ).rejects.toBeInstanceOf(RepoProvisionError);
  });
});
