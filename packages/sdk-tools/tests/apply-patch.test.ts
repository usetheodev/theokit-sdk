import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApplyPatchTool } from "../src/apply-patch.js";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "sdk-patch-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("createApplyPatchTool — tool shape", () => {
  it("Given the factory, Then it returns a CustomTool with name='apply_patch'", () => {
    const tool = createApplyPatchTool({ projectRoot });
    expect(tool.name).toBe("apply_patch");
    expect(typeof tool.handler).toBe("function");
  });
});

describe("createApplyPatchTool — happy path", () => {
  it("Given a valid unified diff, When applied, Then file is modified correctly", async () => {
    writeFileSync(join(projectRoot, "file.ts"), "line1\nline2\nline3\n");
    const patch = [
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -1,3 +1,3 @@",
      " line1",
      "-line2",
      "+line2_modified",
      " line3",
    ].join("\n");
    const tool = createApplyPatchTool({ projectRoot });
    const out = await tool.handler({ patch });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.files_patched).toContain("file.ts");
    const content = readFileSync(join(projectRoot, "file.ts"), "utf-8");
    expect(content).toContain("line2_modified");
    expect(content).not.toContain("\nline2\n");
  });

  it("Given a valid patch, When applied, Then .bak backup is created", async () => {
    writeFileSync(join(projectRoot, "backup.ts"), "old\n");
    const patch = ["--- a/backup.ts", "+++ b/backup.ts", "@@ -1 +1 @@", "-old", "+new"].join("\n");
    const tool = createApplyPatchTool({ projectRoot });
    await tool.handler({ patch });
    expect(existsSync(join(projectRoot, "backup.ts.bak"))).toBe(true);
    expect(readFileSync(join(projectRoot, "backup.ts.bak"), "utf-8")).toBe("old\n");
  });
});

describe("createApplyPatchTool — error scenarios", () => {
  it("Given empty patch, Then result is { ok: false, error: 'parse_error' }", async () => {
    const tool = createApplyPatchTool({ projectRoot });
    const out = await tool.handler({ patch: "no hunks here" });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("parse_error");
  });

  it("Given patch with path traversal, Then result is { ok: false, error: 'path_traversal' }", async () => {
    const patch = [
      "--- a/../../etc/passwd",
      "+++ b/../../etc/passwd",
      "@@ -1 +1 @@",
      "-root",
      "+hacked",
    ].join("\n");
    const tool = createApplyPatchTool({ projectRoot });
    const out = await tool.handler({ patch });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("path_traversal");
  });

  it("Given patch with forbidden path (.env), Then result is { ok: false, error: 'forbidden_path' }", async () => {
    const patch = ["--- a/.env", "+++ b/.env", "@@ -1 +1 @@", "-SECRET=old", "+SECRET=new"].join(
      "\n",
    );
    const tool = createApplyPatchTool({ projectRoot });
    const out = await tool.handler({ patch });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("forbidden_path");
  });

  it("Given patch with context mismatch, Then result is { ok: false, error: 'patch_failed' }", async () => {
    writeFileSync(join(projectRoot, "mismatch.ts"), "actual\n");
    const patch = [
      "--- a/mismatch.ts",
      "+++ b/mismatch.ts",
      "@@ -1 +1 @@",
      " expected_context",
      "-old",
      "+new",
    ].join("\n");
    const tool = createApplyPatchTool({ projectRoot });
    const out = await tool.handler({ patch });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("patch_failed");
  });
});
