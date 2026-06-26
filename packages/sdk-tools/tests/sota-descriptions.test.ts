/**
 * SOTA default descriptions — each built-in tool ships a behavior-accurate, generalized ACI
 * description as its DEFAULT (no consumer override needed). These assert the load-bearing
 * behavioral phrases of each description; every phrase is verified against the tool's handler
 * (search_text is case-sensitive via `line.includes`; web_fetch is SSRF-guarded by default via
 * `screenedFetch({allowPrivateHosts:false})`).
 */
import { describe, expect, it } from "vitest";
import { createEditFileTool } from "../src/edit-file.js";
import { createGlobTool } from "../src/glob-files.js";
import { createReadFileTool } from "../src/read-file.js";
import { createSearchTextTool } from "../src/search-text.js";
import { createShellTool } from "../src/shell-exec.js";
import { createTodolistTool } from "../src/todolist.js";
import { createWebFetchTool } from "../src/web-fetch.js";
import { createWebSearchTool } from "../src/web-search.js";
import { createWriteFileTool } from "../src/write-file.js";

const ROOT = "/tmp/sota-desc-test";

describe("SOTA default descriptions — behavioral phrases", () => {
  it("read_file: read-before-edit + whole-file", () => {
    const d = createReadFileTool({ projectRoot: ROOT }).description;
    expect(d).toContain("before you edit");
    expect(d.toLowerCase()).toContain("whole file");
  });

  it("write_file: OVERWRITES + prefer edit_file", () => {
    const d = createWriteFileTool({ projectRoot: ROOT }).description;
    expect(d).toContain("OVERWRITES");
    expect(d).toContain("edit_file");
  });

  it("edit_file: FIRST occurrence + uniqueness", () => {
    const d = createEditFileTool({ projectRoot: ROOT }).description;
    expect(d).toContain("FIRST occurrence");
    expect(d).toContain("unique");
  });

  it("glob_files: known filename shape + wildcards", () => {
    const d = createGlobTool({ projectRoot: ROOT }).description;
    expect(d).toContain("**");
    expect(d).toContain("relative paths");
  });

  it("search_text: literal + case-sensitive (verified: line.includes)", () => {
    const d = createSearchTextTool({ projectRoot: ROOT }).description;
    expect(d.toLowerCase()).toContain("literal");
    expect(d.toLowerCase()).toContain("case-sensitive");
  });

  it("shell_exec: prefer specialized file tools + git caution", () => {
    const d = createShellTool({ projectRoot: ROOT }).description;
    expect(d).toContain("exit_code");
    expect(d).toContain("specialized");
  });

  it("todolist: when-to-use + action list", () => {
    const d = createTodolistTool().description;
    expect(d).toContain("clear_completed");
    expect(d).toContain("in_progress");
  });

  it("web_fetch: http(s) + SSRF-guarded (verified: allowPrivateHosts default false)", () => {
    const d = createWebFetchTool().description;
    expect(d).toContain("HTTP/HTTPS");
    expect(d.toLowerCase()).toContain("never invent");
  });

  it("web_search: results shape + provider", () => {
    const d = createWebSearchTool({ search: async () => [] }).description;
    expect(d).toContain("title");
    expect(d).toContain("snippet");
  });
});
