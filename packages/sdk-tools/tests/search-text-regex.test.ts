/**
 * M17 — additive grep-parity for createSearchTextTool: opt-in `regex` mode + `allowAbsolute` scope.
 * Both default OFF ⇒ the literal, project-scoped behavior is unchanged.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createSearchTextTool } from "../src/search-text.js";
import { textHandler } from "./text-handler.js";

const roots: string[] = [];
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "search-regex-"));
  roots.push(root);
  writeFileSync(join(root, "a.ts"), "export function mainLoop() {}\nconst x = 1;\n");
  writeFileSync(join(root, "b.ts"), "function helper() {}\n");
  return root;
}
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe("search_text — literal default is unchanged", () => {
  it("matches a literal substring, not a regex, when regex is off", async () => {
    const root = fixture();
    const tool = createSearchTextTool({ projectRoot: root });
    // 'function.*Loop' is a regex; as a LITERAL it matches nothing.
    const r = JSON.parse(await textHandler(tool)({ query: "function.*Loop" }));
    expect(r.ok).toBe(true);
    expect(r.totalMatches).toBe(0);
  });
});

describe("search_text — opt-in regex mode (grep parity)", () => {
  it("matches by regular expression when regex is on", async () => {
    const root = fixture();
    const tool = createSearchTextTool({ projectRoot: root, regex: true });
    const r = JSON.parse(await textHandler(tool)({ query: "function\\s+\\w*Loop" }));
    expect(r.ok).toBe(true);
    expect(r.matches).toContainEqual(
      expect.objectContaining({ file: "a.ts", line: 1, preview: "export function mainLoop() {}" }),
    );
  });

  it("matches both files with an alternation regex", async () => {
    const root = fixture();
    const tool = createSearchTextTool({ projectRoot: root, regex: true });
    const r = JSON.parse(await textHandler(tool)({ query: "mainLoop|helper" }));
    expect(r.totalMatches).toBe(2);
  });

  it("returns a typed error for an invalid regex (fail-clear, no walk)", async () => {
    const root = fixture();
    const tool = createSearchTextTool({ projectRoot: root, regex: true });
    const r = JSON.parse(await textHandler(tool)({ query: "func(" }));
    expect(r).toEqual({ ok: false, error: "invalid_regex", query: "func(" });
  });
});

describe("search_text — opt-in allowAbsolute (reads-anywhere)", () => {
  it("scopes to an absolute directory outside the project when allowAbsolute is set", async () => {
    const inside = fixture();
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    roots.push(outside);
    mkdirSync(join(outside, "sub"));
    writeFileSync(join(outside, "sub", "c.ts"), "const NEEDLE = 1;\n");
    const tool = createSearchTextTool({ projectRoot: inside, allowAbsolute: true });
    const r = JSON.parse(await textHandler(tool)({ query: "NEEDLE", path: outside }));
    expect(r.ok).toBe(true);
    expect(r.totalMatches).toBe(1);
  });

  it("rejects an absolute scope when allowAbsolute is not set", async () => {
    const inside = fixture();
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    roots.push(outside);
    const tool = createSearchTextTool({ projectRoot: inside });
    const r = JSON.parse(await textHandler(tool)({ query: "x", path: outside }));
    expect(r).toMatchObject({ ok: false, error: "path_traversal" });
  });
});
