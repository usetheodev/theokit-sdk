import { type ExecuteResult, SandboxBackend } from "@theokit/sdk/sandbox";
import { describe, expect, it } from "vitest";

import { createGitDiffTool } from "../src/git-diff.js";
import { textHandler } from "./text-handler.js";

class RecordingSandbox extends SandboxBackend {
  calls: string[] = [];
  result: ExecuteResult = { stdout: "diff --git a b", stderr: "", exitCode: 0, timedOut: false };
  async execute(command: string): Promise<ExecuteResult> {
    this.calls.push(command);
    return this.result;
  }
  async uploadFile(): Promise<void> {}
}

describe("git_diff — injected SandboxBackend", () => {
  it("runs `git diff` through the backend and returns the diff (no local .git check)", async () => {
    const sandbox = new RecordingSandbox();
    const tool = createGitDiffTool({ projectRoot: "/nope", sandbox });
    const parsed = JSON.parse(await textHandler(tool)({}));
    expect(sandbox.calls[0]).toContain("git");
    expect(sandbox.calls[0]).toContain("diff");
    expect(parsed).toEqual({ ok: true, diff: "diff --git a b", truncated: false });
  });

  it("maps a 'not a git repository' failure to not_a_repo", async () => {
    const sandbox = new RecordingSandbox();
    sandbox.result = {
      stdout: "",
      stderr: "fatal: not a git repository",
      exitCode: 128,
      timedOut: false,
    };
    const tool = createGitDiffTool({ projectRoot: "/nope", sandbox });
    expect(JSON.parse(await textHandler(tool)({}))).toEqual({ ok: false, error: "not_a_repo" });
  });

  it("single-quotes the path arg (safe against metacharacters)", async () => {
    const sandbox = new RecordingSandbox();
    const tool = createGitDiffTool({ projectRoot: "/nope", sandbox });
    await textHandler(tool)({ path: "src/a.ts" });
    expect(sandbox.calls[0]).toContain("'src/a.ts'");
  });
});
