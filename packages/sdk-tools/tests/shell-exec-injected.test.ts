import { type ExecuteResult, SandboxBackend } from "@theokit/sdk/sandbox";
import { describe, expect, it } from "vitest";

import { createShellTool } from "../src/shell-exec.js";
import { textHandler } from "./text-handler.js";

/** Records the command it was asked to run + returns a canned result — proves shell_exec routes through
 *  the INJECTED backend, never the local child process. */
class RecordingSandbox extends SandboxBackend {
  calls: string[] = [];
  async execute(command: string): Promise<ExecuteResult> {
    this.calls.push(command);
    return { stdout: "hello-from-backend", stderr: "", exitCode: 0, timedOut: false };
  }
  async uploadFile(): Promise<void> {}
}

describe("shell_exec — injected SandboxBackend (surface-agnostic)", () => {
  it("routes the command through the injected backend and maps its result to the tool shape", async () => {
    const sandbox = new RecordingSandbox();
    const tool = createShellTool({ projectRoot: "/nope", sandbox });
    const parsed = JSON.parse(await textHandler(tool)({ command: "echo hi" }));
    expect(sandbox.calls).toEqual(["echo hi"]); // ran via the backend, not local /bin/sh
    expect(parsed).toEqual({ ok: true, stdout: "hello-from-backend", stderr: "", exit_code: 0 });
  });

  it("maps a backend timeout to { ok:false, error:'timeout' }", async () => {
    class TimingOut extends SandboxBackend {
      async execute(): Promise<ExecuteResult> {
        return { stdout: "", stderr: "", exitCode: 124, timedOut: true };
      }
      async uploadFile(): Promise<void> {}
    }
    const tool = createShellTool({ projectRoot: "/nope", sandbox: new TimingOut() });
    const r = JSON.parse(await textHandler(tool)({ command: "sleep 999" }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe("timeout");
  });

  it("the catastrophic guard runs BEFORE the backend (never reaches execute)", async () => {
    const sandbox = new RecordingSandbox();
    const tool = createShellTool({ projectRoot: "/nope", sandbox });
    const parsed = JSON.parse(await textHandler(tool)({ command: "rm -rf /" }));
    expect(parsed.ok).toBe(false);
    expect(sandbox.calls).toEqual([]); // guard short-circuited; backend never called
  });
});
