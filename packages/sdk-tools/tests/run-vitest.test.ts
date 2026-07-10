import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRunVitestTool, extractTrailingJson } from "../src/run-vitest.js";
import { textHandler } from "./_text-handler.js";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "sdk-vitest-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("createRunVitestTool — tool shape", () => {
  it("Given the factory, Then it returns a CustomTool with name='run_vitest'", () => {
    const tool = createRunVitestTool({ projectRoot });
    expect(tool.name).toBe("run_vitest");
    expect(typeof tool.handler).toBe("function");
  });
});

describe("createRunVitestTool — safety boundaries", () => {
  it("Given path traversal in scope, Then error='path_traversal'", async () => {
    const tool = createRunVitestTool({ projectRoot });
    const out = await textHandler(tool)({ path: "../../etc/test.ts" });
    const parsed = JSON.parse(out) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("path_traversal");
  });

  it("Given a forbidden path scope (.git), Then error='forbidden_path'", async () => {
    mkdirSync(join(projectRoot, ".git"));
    const tool = createRunVitestTool({ projectRoot });
    const out = await textHandler(tool)({ path: ".git/something.test.ts" });
    const parsed = JSON.parse(out) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("forbidden_path");
  });
});

describe("createRunVitestTool — EC-12 JSON parsing robustness", () => {
  // EC-12 from the TheoKit Studio review: vitest stdout may contain
  // warnings BEFORE the JSON payload. The parser must extract the LAST
  // JSON object, not fail on the first non-JSON line.
  it("Given stdout with deprecation warnings before the JSON, Then JSON is extracted", () => {
    // This is a unit test on the parsing helper, exported for the case.
    // The integration test (real vitest invocation) lives below — slower.
    const helper = extractTrailingJson;
    const stdout =
      "(node:1234) [DEP0040] DeprecationWarning: some warning\n" +
      'More noise here\n{"numTotalTests": 5, "numPassedTests": 5, "success": true}\n';
    const parsed = helper(stdout);
    expect(parsed).toEqual({
      numTotalTests: 5,
      numPassedTests: 5,
      success: true,
    });
  });

  it("Given stdout with no JSON at all, Then helper returns null", () => {
    const helper = extractTrailingJson;
    expect(helper("just plain text\nno json here")).toBeNull();
  });

  it("Given stdout with multiple JSON-like fragments, Then the LAST valid one wins", () => {
    const helper = extractTrailingJson;
    const stdout =
      '{"partial": true}\n' +
      "intermediate noise\n" +
      '{"numTotalTests": 3, "numPassedTests": 2, "success": false}\n';
    const parsed = helper(stdout) as { numTotalTests: number };
    expect(parsed.numTotalTests).toBe(3);
  });
});
