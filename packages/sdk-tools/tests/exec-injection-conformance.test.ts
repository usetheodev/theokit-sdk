/**
 * End-to-end evidence for the exec-side injection: shell_exec / git_diff routed through a REAL
 * `LocalSandbox` (not a fake) actually run the command and map its result to the tool's JSON shape.
 * Unlike the fs tools, a sandbox backend legitimately differs from the local child process, so this
 * asserts correct end-to-end behavior rather than byte-identity with the local path.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalSandbox } from "@theokit/sdk/sandbox";
import { afterEach, describe, expect, it } from "vitest";

import { createGitDiffTool } from "../src/git-diff.js";
import { createShellTool } from "../src/shell-exec.js";
import { textHandler } from "./text-handler.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("exec-injection — real LocalSandbox backend", () => {
  it("shell_exec runs the command through the sandbox", async () => {
    const root = mkdtempSync(join(tmpdir(), "exec-conf-"));
    dirs.push(root);
    const tool = createShellTool({
      projectRoot: root,
      sandbox: new LocalSandbox({ workDir: root }),
    });
    const parsed = JSON.parse(await textHandler(tool)({ command: "echo hello-sandbox" }));
    expect(parsed.ok).toBe(true);
    expect(parsed.exit_code).toBe(0);
    expect(parsed.stdout).toContain("hello-sandbox");
  });

  it("git_diff returns the working-tree diff through the sandbox", async () => {
    const root = mkdtempSync(join(tmpdir(), "gitdiff-conf-"));
    dirs.push(root);
    execSync("git init -q && git config user.email t@t && git config user.name t", { cwd: root });
    writeFileSync(join(root, "f.txt"), "one\n");
    execSync("git add -A && git commit -q -m init", { cwd: root });
    writeFileSync(join(root, "f.txt"), "one\ntwo\n");
    const tool = createGitDiffTool({
      projectRoot: root,
      sandbox: new LocalSandbox({ workDir: root }),
    });
    const parsed = JSON.parse(await textHandler(tool)({}));
    expect(parsed.ok).toBe(true);
    expect(parsed.diff).toContain("+two");
  });
});
