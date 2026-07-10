import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToolList, withDescription } from "../src/internal/tool-aci.js";
import { createReadFileTool } from "../src/read-file.js";
import { textHandler } from "./_text-handler.js";

function fakeTool(name: string, description: string) {
  return {
    name,
    description,
    inputSchema: { type: "object" } as Record<string, unknown>,
    handler: () => '{"ok":true}',
  };
}

describe("withDescription", () => {
  it("overrides only the description", () => {
    const tool = fakeTool("read_file", "old");
    const out = withDescription(tool, "new");
    expect(out.description).toBe("new");
    expect(out.name).toBe(tool.name);
    expect(out.inputSchema).toBe(tool.inputSchema);
    expect(out.handler).toBe(tool.handler);
  });

  it("does not mutate the original tool", () => {
    const tool = fakeTool("read_file", "old");
    withDescription(tool, "new");
    expect(tool.description).toBe("old");
  });

  it("overrides on a real built-in tool, handler still works", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "sdk-aci-"));
    try {
      writeFileSync(join(projectRoot, "hi.txt"), "hello");
      const tool = withDescription(createReadFileTool({ projectRoot }), "custom desc");
      expect(tool.description).toBe("custom desc");
      const parsed = JSON.parse(await textHandler(tool)({ path: "hi.txt" }));
      expect(parsed.ok).toBe(true);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

describe("renderToolList", () => {
  it("lists each tool's name and description", () => {
    const out = renderToolList([
      fakeTool("read_file", "Read a file"),
      fakeTool("list_dir", "List a dir"),
    ]);
    expect(out).toContain("read_file");
    expect(out).toContain("Read a file");
    expect(out).toContain("list_dir");
    expect(out).toContain("List a dir");
  });

  it("reflects an overridden description (single source, no drift)", () => {
    const out = renderToolList([withDescription(fakeTool("read_file", "old"), "OVERRIDDEN")]);
    expect(out).toContain("OVERRIDDEN");
    expect(out).not.toContain(">old<");
  });

  it("renders a well-formed empty block for an empty array (no throw)", () => {
    expect(renderToolList([])).toBe("<tools></tools>");
  });

  it("escapes angle brackets and ampersands in the description", () => {
    const out = renderToolList([fakeTool("t", "<b> & </b>")]);
    expect(out).toContain("&lt;b&gt;");
    expect(out).toContain("&amp;");
    expect(out).not.toContain("<b>");
  });

  it("escapes ampersand before angle brackets (no double-escape) (EC-1)", () => {
    const out = renderToolList([fakeTool("t", "a < b & c")]);
    expect(out).toContain("&lt;");
    expect(out).toContain("&amp;");
    expect(out).not.toContain("&amp;lt;");
  });

  it("escapes the tool NAME too (no `<tools>` block injection)", () => {
    const out = renderToolList([fakeTool("a</name>x", "d")]);
    expect(out).toContain("&lt;/name&gt;");
    expect(out).not.toContain("</name>x");
  });

  it("summary mode renders `- name: <first sentence>`", () => {
    const out = renderToolList([fakeTool("read_file", "Read a file. More detail here.")], {
      mode: "summary",
    });
    expect(out).toBe("- read_file: Read a file.");
  });

  it("summary mode first-sentence extraction is abbreviation-safe", () => {
    const out = renderToolList([fakeTool("t", "Use e.g. this. Second.")], { mode: "summary" });
    expect(out).toBe("- t: Use e.g. this.");
  });

  it("summary mode joins multiple tools with newlines", () => {
    const out = renderToolList(
      [fakeTool("read_file", "Read a file."), fakeTool("list_dir", "List a dir.")],
      { mode: "summary" },
    );
    expect(out).toBe("- read_file: Read a file.\n- list_dir: List a dir.");
  });

  it("summary mode on empty array yields empty string", () => {
    expect(renderToolList([], { mode: "summary" })).toBe("");
  });

  it("names mode renders `- name` lines only, no descriptions", () => {
    const out = renderToolList(
      [fakeTool("read_file", "Read a file."), fakeTool("list_dir", "List a dir.")],
      { mode: "names" },
    );
    expect(out).toBe("- read_file\n- list_dir");
  });

  it("names mode on empty array yields empty string", () => {
    expect(renderToolList([], { mode: "names" })).toBe("");
  });

  it("default (no options) equals the existing <tools> XML", () => {
    const tools = [fakeTool("read_file", "Read a file"), fakeTool("list_dir", "List a dir")];
    const expected = [
      "<tools>",
      "  <tool>",
      "    <name>read_file</name>",
      "    <description>Read a file</description>",
      "  </tool>",
      "  <tool>",
      "    <name>list_dir</name>",
      "    <description>List a dir</description>",
      "  </tool>",
      "</tools>",
    ].join("\n");
    expect(renderToolList(tools)).toBe(expected);
    expect(renderToolList(tools, { mode: "full" })).toBe(expected);
  });

  it("non-object 2nd arg (e.g. a map index) falls back to full XML (no crash)", () => {
    const tools = [fakeTool("read_file", "Read a file")];
    // Simulates tools.map(renderToolList) passing (item, index)
    expect(renderToolList(tools, 1 as never)).toBe(renderToolList(tools));
  });

  it("summary mode does NOT xml-escape (markdown, not XML)", () => {
    const out = renderToolList([fakeTool("t", "<b> stays literal.")], { mode: "summary" });
    expect(out).toBe("- t: <b> stays literal.");
    expect(out).not.toContain("&lt;b&gt;");
  });
});

describe("sdk-tools barrel — tool-aci", () => {
  it("re-exports withDescription and renderToolList", async () => {
    const mod = await import("../src/index.js");
    expect(typeof mod.withDescription).toBe("function");
    expect(typeof mod.renderToolList).toBe("function");
  });
});
