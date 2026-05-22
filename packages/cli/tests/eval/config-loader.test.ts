/**
 * T5.1 config-loader tests.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadEvalConfig } from "../../src/eval/config-loader.js";

let workDir: string;
beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "tk-eval-cfg-"));
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("loadEvalConfig (T5.1)", () => {
  it("throws config_not_found when file missing", async () => {
    await expect(loadEvalConfig(workDir, "missing.config.mjs")).rejects.toMatchObject({
      code: "config_not_found",
    });
  });

  it("loads default export from .mjs", async () => {
    const path = join(workDir, "eval.config.mjs");
    writeFileSync(
      path,
      `export default {
  dataset: [{ input: "hi" }],
  scorers: [{ name: "noop", score: () => ({ score: 1 }) }],
  agent: { apiKey: "local", model: { id: "ollama/llama3.2:3b" } },
};`,
      "utf8",
    );
    const config = await loadEvalConfig(workDir, "eval.config.mjs");
    expect(config.dataset).toHaveLength(1);
    expect(config.scorers).toHaveLength(1);
  });

  it("rejects missing default export", async () => {
    const path = join(workDir, "no-default.mjs");
    writeFileSync(path, `export const x = 1;`, "utf8");
    await expect(loadEvalConfig(workDir, "no-default.mjs")).rejects.toMatchObject({
      code: "config_no_default_export",
    });
  });

  it("rejects invalid shape (dataset not array)", async () => {
    const path = join(workDir, "bad-shape.mjs");
    writeFileSync(path, `export default { dataset: "not-array", scorers: [], agent: {} };`, "utf8");
    await expect(loadEvalConfig(workDir, "bad-shape.mjs")).rejects.toMatchObject({
      code: "config_invalid_shape",
    });
  });
});
