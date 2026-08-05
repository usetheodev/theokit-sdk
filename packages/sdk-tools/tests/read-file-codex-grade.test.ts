/**
 * M17 — additive Codex-grade upgrades to createReadFileTool: `lineNumbers`, `offset`/`limit` pagination,
 * and opt-in `allowAbsolute`. Every new capability is OFF by default so existing consumers are unchanged.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createReadFileTool } from "../src/read-file.js";
import { textHandler } from "./text-handler.js";

const roots: string[] = [];
function fixture(content: string, name = "a.txt"): { root: string; abs: string } {
  const root = mkdtempSync(join(tmpdir(), "readfile-codex-"));
  roots.push(root);
  writeFileSync(join(root, name), content);
  return { root, abs: join(root, name) };
}
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe("createReadFileTool — default behavior is byte-identical (backward compat)", () => {
  it("returns the whole raw content with no options set", async () => {
    const { root } = fixture("line1\nline2\nline3\n");
    const tool = createReadFileTool({ projectRoot: root });
    const r = JSON.parse(await textHandler(tool)({ path: "a.txt" }));
    expect(r).toMatchObject({ ok: true, content: "line1\nline2\nline3\n" });
  });

  it("still refuses an absolute path OUTSIDE the project when allowAbsolute is not set", async () => {
    const { root } = fixture("in-project\n");
    const outside = fixture("outside-body\n", "b.txt").abs; // a different temp dir
    const tool = createReadFileTool({ projectRoot: root });
    const r = JSON.parse(await textHandler(tool)({ path: outside }));
    expect(r).toEqual({ ok: false, error: "path_traversal", path: outside });
  });
});

describe("createReadFileTool — lineNumbers + pagination (Codex-grade)", () => {
  it("renders cat -n style numbered lines when lineNumbers is on", async () => {
    const { root } = fixture("alpha\nbeta\ngamma\n");
    const tool = createReadFileTool({ projectRoot: root, lineNumbers: true });
    const r = JSON.parse(await textHandler(tool)({ path: "a.txt" }));
    // trailing "\n" makes a 4th empty line; numbering covers each split line.
    expect(r.ok).toBe(true);
    expect(r.content.split("\n").slice(0, 3)).toEqual(["1\talpha", "2\tbeta", "3\tgamma"]);
  });

  it("paginates with offset + limit (1-based)", async () => {
    const { root } = fixture("l1\nl2\nl3\nl4\nl5\n");
    const tool = createReadFileTool({ projectRoot: root, lineNumbers: true });
    const r = JSON.parse(await textHandler(tool)({ path: "a.txt", offset: 2, limit: 2 }));
    expect(r.content).toBe("2\tl2\n3\tl3");
  });
});

describe("createReadFileTool — opt-in allowAbsolute (reads-anywhere, secret guard intact)", () => {
  it("reads an absolute path outside the project when allowAbsolute is set", async () => {
    const { abs } = fixture("outside-body\n");
    // projectRoot is a DIFFERENT dir; the file is read by absolute path.
    const other = mkdtempSync(join(tmpdir(), "proj-"));
    roots.push(other);
    const tool = createReadFileTool({ projectRoot: other, allowAbsolute: true });
    const r = JSON.parse(await textHandler(tool)({ path: abs }));
    expect(r).toMatchObject({ ok: true, content: "outside-body\n" });
  });

  it("STILL blocks a forbidden secret file even with allowAbsolute (guard runs first)", async () => {
    const { root } = fixture("KEY=secret\n", ".env");
    const tool = createReadFileTool({ projectRoot: root, allowAbsolute: true });
    const r = JSON.parse(await textHandler(tool)({ path: join(root, ".env") }));
    expect(r).toEqual({ ok: false, error: "forbidden_path", path: join(root, ".env") });
  });
});
