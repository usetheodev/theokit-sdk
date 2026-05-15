import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runShell } from "../../../src/internal/runtime/shell-tool.js";

/**
 * Behaviour gate for the real shell tool. Verifies stdout/exitCode capture,
 * timeout behaviour, and the sandbox refusal heuristic.
 */

describe("real shell tool", () => {
  let cwd: string | undefined;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-shell-"));
    await writeFile(join(cwd, "hello.txt"), "hello world\n");
  });
  afterEach(() => {
    cwd = undefined;
  });

  it("captures stdout and exit code from a successful command", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const result = await runShell({ command: "cat hello.txt", cwd });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello world");
    expect(result.timedOut).toBe(false);
  });

  it("surfaces non-zero exit code without throwing", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const result = await runShell({ command: "ls /this-path-does-not-exist", cwd });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it("kills runaway commands once the timeout elapses", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const result = await runShell({ command: "sleep 5", cwd, timeoutMs: 150 });
    expect(result.timedOut).toBe(true);
  });

  it("refuses obviously unsafe commands when sandboxed", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const result = await runShell({
      command: "rm -rf /etc/passwd",
      cwd,
      sandbox: true,
    });
    expect(result.exitCode).toBe(126);
    expect(result.stderr).toMatch(/Sandbox refused/);
  });
});
