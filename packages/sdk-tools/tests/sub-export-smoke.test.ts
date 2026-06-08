import { describe, expect, it } from "vitest";

import * as Tools from "../src/index.js";

/**
 * Smoke test pinning the public surface of the `@theokit/sdk/tools` sub-export.
 *
 * When the published bundle ships, consumers import via:
 *
 *   import { createReadFileTool, createListDirTool, createSearchTextTool } from "@theokit/sdk/tools";
 *
 * This test guards against accidental rename / removal in `src/index.ts`.
 */

describe("@theokit/sdk/tools — sub-export barrel", () => {
  it("exports createReadFileTool", () => {
    expect(typeof Tools.createReadFileTool).toBe("function");
  });

  it("exports createListDirTool", () => {
    expect(typeof Tools.createListDirTool).toBe("function");
  });

  it("exports createSearchTextTool", () => {
    expect(typeof Tools.createSearchTextTool).toBe("function");
  });

  it("exports createGitDiffTool", () => {
    expect(typeof Tools.createGitDiffTool).toBe("function");
  });

  it("exports createRunVitestTool", () => {
    expect(typeof Tools.createRunVitestTool).toBe("function");
  });
});
