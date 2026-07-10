import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createListDirTool } from "../src/list-dir.js";
import { textHandler } from "./text-handler.js";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "sdk-listdir-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("createListDirTool — tool shape", () => {
  it("Given the factory, Then it returns a CustomTool with name='list_dir'", () => {
    const tool = createListDirTool({ projectRoot });
    expect(tool.name).toBe("list_dir");
    expect(typeof tool.handler).toBe("function");
  });
});

describe("createListDirTool — happy path", () => {
  it("Given a dir with files + subdirs, When listed, Then each entry exposes name + type", async () => {
    mkdirSync(join(projectRoot, "app"));
    writeFileSync(join(projectRoot, "app", "page.tsx"), "");
    mkdirSync(join(projectRoot, "app", "ui"));
    const tool = createListDirTool({ projectRoot });
    const out = await textHandler(tool)({ path: "app" });
    const parsed = JSON.parse(out) as {
      ok: boolean;
      entries: Array<{ name: string; type: "file" | "directory" }>;
      truncated: boolean;
      totalCount: number;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.entries).toHaveLength(2);
    const byName = Object.fromEntries(parsed.entries.map((e) => [e.name, e.type]));
    expect(byName).toEqual({ "page.tsx": "file", ui: "directory" });
    expect(parsed.truncated).toBe(false);
    expect(parsed.totalCount).toBe(2);
  });

  it("Given an empty path, Then root is listed", async () => {
    writeFileSync(join(projectRoot, "a.txt"), "");
    const tool = createListDirTool({ projectRoot });
    const out = await textHandler(tool)({ path: "." });
    const parsed = JSON.parse(out) as { ok: boolean; entries: Array<{ name: string }> };
    expect(parsed.ok).toBe(true);
    expect(parsed.entries.map((e) => e.name)).toContain("a.txt");
  });
});

describe("createListDirTool — EC-6 entry cap", () => {
  it("Given 600 files and default cap=500, Then truncated=true and entries length=500", async () => {
    for (let i = 0; i < 600; i += 1) {
      writeFileSync(join(projectRoot, `f${String(i).padStart(4, "0")}.txt`), "");
    }
    const tool = createListDirTool({ projectRoot });
    const out = await textHandler(tool)({ path: "." });
    const parsed = JSON.parse(out) as {
      ok: boolean;
      entries: Array<{ name: string }>;
      truncated: boolean;
      totalCount: number;
    };
    expect(parsed.entries).toHaveLength(500);
    expect(parsed.truncated).toBe(true);
    expect(parsed.totalCount).toBe(600);
  });

  it("Given a custom max override, Then the cap is honoured", async () => {
    for (let i = 0; i < 20; i += 1) {
      writeFileSync(join(projectRoot, `f${i}.txt`), "");
    }
    const tool = createListDirTool({ projectRoot, max: 5 });
    const out = await textHandler(tool)({ path: "." });
    const parsed = JSON.parse(out) as {
      ok: boolean;
      entries: unknown[];
      truncated: boolean;
      totalCount: number;
    };
    expect(parsed.entries).toHaveLength(5);
    expect(parsed.truncated).toBe(true);
    expect(parsed.totalCount).toBe(20);
  });
});

describe("createListDirTool — safety boundaries", () => {
  it("Given path traversal attempt, Then error='path_traversal'", async () => {
    const tool = createListDirTool({ projectRoot });
    const out = await textHandler(tool)({ path: "../etc" });
    const parsed = JSON.parse(out) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("path_traversal");
  });

  it("Given a forbidden dir (.git), Then error='forbidden_path'", async () => {
    mkdirSync(join(projectRoot, ".git"));
    const tool = createListDirTool({ projectRoot });
    const out = await textHandler(tool)({ path: ".git" });
    const parsed = JSON.parse(out) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("forbidden_path");
  });

  it("Given a missing dir, Then error='not_found'", async () => {
    const tool = createListDirTool({ projectRoot });
    const out = await textHandler(tool)({ path: "missing-dir" });
    const parsed = JSON.parse(out) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("not_found");
  });
});
