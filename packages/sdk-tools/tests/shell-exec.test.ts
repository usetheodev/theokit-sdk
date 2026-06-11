import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createShellTool } from "../src/shell-exec.js";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "sdk-shell-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("createShellTool — tool shape", () => {
  it("Given the factory, Then it returns a CustomTool with name='shell_exec'", () => {
    const tool = createShellTool({ projectRoot });
    expect(tool.name).toBe("shell_exec");
    expect(typeof tool.handler).toBe("function");
  });
});

describe("createShellTool — happy path", () => {
  it("Given 'echo hello', Then returns stdout with hello", async () => {
    const tool = createShellTool({ projectRoot });
    const out = await tool.handler({ command: "echo hello" });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.stdout.trim()).toBe("hello");
    expect(parsed.exit_code).toBe(0);
  });

  it("Given a failing command, Then returns non-zero exit_code", async () => {
    const tool = createShellTool({ projectRoot });
    const out = await tool.handler({ command: "exit 42" });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.exit_code).toBe(42);
  });

  it("Given command with stderr, Then stderr is captured", async () => {
    const tool = createShellTool({ projectRoot });
    const out = await tool.handler({ command: "echo err >&2" });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.stderr.trim()).toBe("err");
  });
});

describe("createShellTool — timeout", () => {
  it("Given a slow command with short timeout, Then returns timeout error", async () => {
    const tool = createShellTool({ projectRoot, defaultTimeoutMs: 500 });
    const out = await tool.handler({ command: "sleep 10" });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("timeout");
  }, 10_000);

  it("Given timeout_ms override, Then it respects the override", async () => {
    const tool = createShellTool({ projectRoot, defaultTimeoutMs: 60_000 });
    const out = await tool.handler({ command: "sleep 10", timeout_ms: 500 });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("timeout");
  }, 10_000);
});

describe("createShellTool — cwd", () => {
  it("Given the projectRoot, When pwd is executed, Then output is the projectRoot", async () => {
    const tool = createShellTool({ projectRoot });
    const out = await tool.handler({ command: "pwd" });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    // realpath resolves symlinks (/tmp on macOS -> /private/tmp)
    expect(parsed.stdout.trim()).toContain("sdk-shell-");
  });
});
