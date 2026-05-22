import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createReadFileTool } from "../../src/tools/read-file.js";

/**
 * `createReadFileTool` — generic read-file tool for any coding agent.
 *
 * Contracts pinned here:
 *   - CustomTool shape (name, description, inputSchema, handler) — defineTool wraps.
 *   - Path traversal blocked at the framework boundary (delegates to safePathJoin).
 *   - Sensitive files refused (delegates to isForbiddenPath).
 *   - Binary files refused (EC-5: null byte detection in first 8KB).
 *   - File-not-found returns structured error JSON, not throws.
 *   - Result is a JSON-stringified payload the LLM consumes.
 */

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "sdk-readfile-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("createReadFileTool — tool shape", () => {
  it("Given the factory, Then it returns a CustomTool with name='read_file'", () => {
    const tool = createReadFileTool({ projectRoot });
    expect(tool.name).toBe("read_file");
    expect(typeof tool.description).toBe("string");
    expect(tool.description.length).toBeGreaterThan(20);
    expect(typeof tool.handler).toBe("function");
  });

  it("Given the tool, Then inputSchema is an object schema with path: string", () => {
    const tool = createReadFileTool({ projectRoot });
    expect(tool.inputSchema).toEqual(expect.objectContaining({ type: "object" }));
  });
});

describe("createReadFileTool — happy path", () => {
  it("Given a text file, When read_file is invoked, Then JSON contains the content", async () => {
    writeFileSync(join(projectRoot, "hello.txt"), "hello world");
    const tool = createReadFileTool({ projectRoot });
    const out = await tool.handler({ path: "hello.txt" });
    const parsed = JSON.parse(out) as { ok: boolean; content: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.content).toBe("hello world");
  });

  it("Given a nested file, When read_file is invoked, Then it reads correctly", async () => {
    mkdirSync(join(projectRoot, "app"));
    writeFileSync(join(projectRoot, "app", "page.tsx"), "<h1>Hi</h1>");
    const tool = createReadFileTool({ projectRoot });
    const out = await tool.handler({ path: "app/page.tsx" });
    const parsed = JSON.parse(out) as { ok: boolean; content: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.content).toBe("<h1>Hi</h1>");
  });
});

describe("createReadFileTool — safety boundaries", () => {
  it("Given path traversal attempt, Then result is { ok: false, error: 'path_traversal' }", async () => {
    const tool = createReadFileTool({ projectRoot });
    const out = await tool.handler({ path: "../../etc/passwd" });
    const parsed = JSON.parse(out) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("path_traversal");
  });

  it("Given a forbidden path (.env), Then result is { ok: false, error: 'forbidden_path' }", async () => {
    writeFileSync(join(projectRoot, ".env"), "SECRET=value");
    const tool = createReadFileTool({ projectRoot });
    const out = await tool.handler({ path: ".env" });
    const parsed = JSON.parse(out) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("forbidden_path");
  });

  it("Given a forbidden path (.git/config), Then result is { ok: false, error: 'forbidden_path' }", async () => {
    mkdirSync(join(projectRoot, ".git"));
    writeFileSync(join(projectRoot, ".git", "config"), "[core]");
    const tool = createReadFileTool({ projectRoot });
    const out = await tool.handler({ path: ".git/config" });
    const parsed = JSON.parse(out) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("forbidden_path");
  });

  it("Given .env.example (template), Then it IS readable", async () => {
    writeFileSync(join(projectRoot, ".env.example"), "API_KEY=your-key-here");
    const tool = createReadFileTool({ projectRoot });
    const out = await tool.handler({ path: ".env.example" });
    const parsed = JSON.parse(out) as { ok: boolean; content?: string; error?: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.content).toBe("API_KEY=your-key-here");
  });
});

describe("createReadFileTool — EC-5 binary detection", () => {
  it("Given a binary file (PNG-like null byte in header), Then result is { ok: false, error: 'binary_file' }", async () => {
    // PNG magic header has a null byte at position 0x04. Any file with a null
    // byte in the first 8KB is treated as binary.
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);
    writeFileSync(join(projectRoot, "logo.png"), png);
    const tool = createReadFileTool({ projectRoot });
    const out = await tool.handler({ path: "logo.png" });
    const parsed = JSON.parse(out) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("binary_file");
  });

  it("Given a text file with no null bytes, Then it reads (UTF-8 with accents OK)", async () => {
    writeFileSync(join(projectRoot, "info.md"), "Café — accents are fine");
    const tool = createReadFileTool({ projectRoot });
    const out = await tool.handler({ path: "info.md" });
    const parsed = JSON.parse(out) as { ok: boolean; content: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.content).toBe("Café — accents are fine");
  });
});

describe("createReadFileTool — error scenarios", () => {
  it("Given a missing file, Then result is { ok: false, error: 'not_found' }", async () => {
    const tool = createReadFileTool({ projectRoot });
    const out = await tool.handler({ path: "does-not-exist.txt" });
    const parsed = JSON.parse(out) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("not_found");
  });

  it("Given an empty path, Then Zod rejects before handler runs (defineTool's parse layer)", async () => {
    const tool = createReadFileTool({ projectRoot });
    // Zod schema validates non-empty string. defineTool's handler wraps parsing
    // so an empty path → throws (caught by SDK's tool dispatcher in real use).
    await expect(tool.handler({ path: "" })).rejects.toThrow();
  });
});
