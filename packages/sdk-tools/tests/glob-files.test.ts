import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createGlobTool } from "../src/glob-files.js";
import { textHandler } from "./text-handler.js";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "sdk-glob-"));
  mkdirSync(join(projectRoot, "src"));
  mkdirSync(join(projectRoot, "src/utils"));
  writeFileSync(join(projectRoot, "src/index.ts"), "export {}");
  writeFileSync(join(projectRoot, "src/utils/helpers.ts"), "export {}");
  writeFileSync(join(projectRoot, "README.md"), "# Hello");
  writeFileSync(join(projectRoot, "package.json"), "{}");
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("createGlobTool — tool shape", () => {
  it("Given the factory, Then it returns a CustomTool with name='glob_files'", () => {
    const tool = createGlobTool({ projectRoot });
    expect(tool.name).toBe("glob_files");
    expect(typeof tool.handler).toBe("function");
  });
});

describe("createGlobTool — happy path", () => {
  it("Given pattern '**/*.ts', Then returns all .ts files", async () => {
    const tool = createGlobTool({ projectRoot });
    const out = await textHandler(tool)({ pattern: "**/*.ts" });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.files).toContain("src/index.ts");
    expect(parsed.files).toContain("src/utils/helpers.ts");
    expect(parsed.files).not.toContain("README.md");
  });

  it("Given pattern '*.md', Then returns only root .md files", async () => {
    const tool = createGlobTool({ projectRoot });
    const out = await textHandler(tool)({ pattern: "*.md" });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.files).toContain("README.md");
    expect(parsed.count).toBe(1);
  });

  it("Given cwd='src', pattern='*.ts', Then returns files relative to project root", async () => {
    const tool = createGlobTool({ projectRoot });
    const out = await textHandler(tool)({ pattern: "*.ts", cwd: "src" });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.files).toContain("src/index.ts");
  });
});

describe("createGlobTool — exclusions", () => {
  it("Given node_modules exists, Then it is excluded from results", async () => {
    mkdirSync(join(projectRoot, "node_modules/dep"), { recursive: true });
    writeFileSync(join(projectRoot, "node_modules/dep/index.js"), "module.exports = {}");
    const tool = createGlobTool({ projectRoot });
    const out = await textHandler(tool)({ pattern: "**/*.js" });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    const nodeModFiles = parsed.files.filter((f: string) => f.includes("node_modules"));
    expect(nodeModFiles).toHaveLength(0);
  });

  it("Given .git dir exists, Then it is excluded from results", async () => {
    mkdirSync(join(projectRoot, ".git"));
    writeFileSync(join(projectRoot, ".git/config"), "[core]");
    const tool = createGlobTool({ projectRoot });
    const out = await textHandler(tool)({ pattern: "**/*" });
    const parsed = JSON.parse(out);
    const gitFiles = parsed.files.filter((f: string) => f.includes(".git"));
    expect(gitFiles).toHaveLength(0);
  });
});

describe("createGlobTool — safety boundaries", () => {
  it("Given cwd with path traversal, Then result is { ok: false, error: 'path_traversal' }", async () => {
    const tool = createGlobTool({ projectRoot });
    const out = await textHandler(tool)({ pattern: "*.ts", cwd: "../../.." });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("path_traversal");
  });
});
