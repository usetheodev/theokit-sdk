import { afterEach, describe, expect, it } from "vitest";
import { detectIde, ideCommand } from "../../src/infra/ide-bridge.js";

describe("detectIde", () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    process.env = { ...origEnv };
  });

  it("returns null when no IDE env vars are set", () => {
    delete process.env["VSCODE_PID"];
    delete process.env["TERM_PROGRAM"];
    delete process.env["CURSOR_TRACE_DIR"];
    delete process.env["CURSOR_CHANNEL"];
    expect(detectIde()).toBeNull();
  });

  it("detects vscode via VSCODE_PID", () => {
    process.env["VSCODE_PID"] = "12345";
    delete process.env["CURSOR_TRACE_DIR"];
    delete process.env["CURSOR_CHANNEL"];
    expect(detectIde()).toBe("vscode");
  });

  it("detects cursor via CURSOR_CHANNEL", () => {
    process.env["CURSOR_CHANNEL"] = "stable";
    expect(detectIde()).toBe("cursor");
  });

  it("cursor takes precedence over vscode", () => {
    process.env["VSCODE_PID"] = "12345";
    process.env["CURSOR_TRACE_DIR"] = "/tmp/cursor";
    expect(detectIde()).toBe("cursor");
  });
});

describe("ideCommand", () => {
  it("builds an open command", () => {
    const cmd = ideCommand("open", { path: "/foo/bar.ts", line: 42 });
    expect(cmd).toEqual({ type: "open", path: "/foo/bar.ts", line: 42 });
  });

  it("builds a diff command", () => {
    const cmd = ideCommand("diff", { path: "/foo/bar.ts", diff: "+added line" });
    expect(cmd).toEqual({ type: "diff", path: "/foo/bar.ts", diff: "+added line" });
  });

  it("omits optional fields when not provided", () => {
    const cmd = ideCommand("open", { path: "/foo.ts" });
    expect(cmd).toEqual({ type: "open", path: "/foo.ts" });
    expect(cmd).not.toHaveProperty("line");
    expect(cmd).not.toHaveProperty("diff");
  });
});
