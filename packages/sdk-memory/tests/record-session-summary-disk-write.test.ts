/**
 * sdk-memory's `createInMemoryMarkdownProvider.recordSessionSummary` end-
 * to-end disk-write test (SDK 2.0 Phase 1 physical Stage 3 prep — iter 33).
 *
 * Validates:
 *   - On `status === "finished"`: markdown file is written to
 *     `${cwd}/.theokit/memory/sessions/${runId}.md` with the canonical
 *     YAML frontmatter + User/Assistant sections.
 *   - On non-finished status: NO disk write happens.
 *   - runId sanitization (path-traversal patterns stripped).
 *   - Long text fields are truncated at 2000 chars.
 *   - Cross-package import works (sdk-memory imports
 *     `replaceFileAtomic` from `@theokit/sdk/internal/persistence`).
 */

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createInMemoryMarkdownProvider, resolveMemoryRoot } from "@theokit/sdk-memory";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("createInMemoryMarkdownProvider.recordSessionSummary (iter 33)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "sdk-memory-rss-"));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("test_finished_run_writes_markdown_file_to_canonical_path", async () => {
    const provider = createInMemoryMarkdownProvider();
    if (provider.recordSessionSummary === undefined) {
      throw new Error("recordSessionSummary not defined on provider");
    }
    await provider.recordSessionSummary({
      cwd: cwd,
      memoryRoot: resolveMemoryRoot(cwd),
      runId: "run-abc",
      agentId: "agent-1",
      userText: "what is 2+2?",
      assistantText: "4",
      status: "finished",
      at: Date.UTC(2026, 5, 8, 12, 30, 45),
    });
    const filePath = join(cwd, ".theokit", "memory", "sessions", "run-abc.md");
    const fileStat = await stat(filePath);
    expect(fileStat.isFile()).toBe(true);
    const content = await readFile(filePath, "utf-8");
    // YAML frontmatter
    expect(content).toContain("---");
    expect(content).toContain("runId: run-abc");
    expect(content).toContain("agentId: agent-1");
    expect(content).toContain("at: 2026-06-08T12:30:45.000Z");
    expect(content).toContain("status: finished");
    // Sections
    expect(content).toContain("## User");
    expect(content).toContain("what is 2+2?");
    expect(content).toContain("## Assistant");
    expect(content).toContain("4");
  });

  it("test_non_finished_status_skips_disk_write", async () => {
    const provider = createInMemoryMarkdownProvider();
    if (provider.recordSessionSummary === undefined) {
      throw new Error("recordSessionSummary not defined");
    }
    await provider.recordSessionSummary({
      cwd: cwd,
      memoryRoot: resolveMemoryRoot(cwd),
      runId: "run-err",
      agentId: "agent-1",
      userText: "u",
      assistantText: "",
      status: "error",
      at: Date.now(),
    });
    const filePath = join(cwd, ".theokit", "memory", "sessions", "run-err.md");
    await expect(stat(filePath)).rejects.toThrow();
  });

  it("test_runId_path_traversal_is_sanitized", async () => {
    const provider = createInMemoryMarkdownProvider();
    if (provider.recordSessionSummary === undefined) {
      throw new Error("recordSessionSummary not defined");
    }
    // Attempted traversal — should be sanitized to underscores.
    await provider.recordSessionSummary({
      cwd: cwd,
      memoryRoot: resolveMemoryRoot(cwd),
      runId: "../../etc/passwd",
      agentId: "agent-1",
      userText: "u",
      assistantText: "a",
      status: "finished",
      at: Date.now(),
    });
    // The original traversal target should NOT exist.
    await expect(stat(join(cwd, "..", "..", "etc", "passwd.md"))).rejects.toThrow();
    // The sanitized path inside `cwd/.theokit/memory/sessions/` SHOULD exist.
    // `../../etc/passwd` becomes `______etc_passwd` after sanitization.
    const sanitizedPath = join(cwd, ".theokit", "memory", "sessions", "______etc_passwd.md");
    const fileStat = await stat(sanitizedPath);
    expect(fileStat.isFile()).toBe(true);
  });

  it("test_long_text_fields_truncated_at_2000_chars", async () => {
    const provider = createInMemoryMarkdownProvider();
    if (provider.recordSessionSummary === undefined) {
      throw new Error("recordSessionSummary not defined");
    }
    const longText = "x".repeat(2500);
    await provider.recordSessionSummary({
      cwd: cwd,
      memoryRoot: resolveMemoryRoot(cwd),
      runId: "run-trunc",
      agentId: "agent-1",
      userText: longText,
      assistantText: longText,
      status: "finished",
      at: Date.now(),
    });
    const filePath = join(cwd, ".theokit", "memory", "sessions", "run-trunc.md");
    const content = await readFile(filePath, "utf-8");
    // The truncated text should be present + the "…" ellipsis marker.
    expect(content).toContain("…");
    // The 2500-char input should NOT survive verbatim.
    expect(content.includes("x".repeat(2500))).toBe(false);
    // The first 2000 chars should be there.
    expect(content).toContain("x".repeat(2000));
  });

  it("test_creates_nested_sessions_directory_on_first_write", async () => {
    const provider = createInMemoryMarkdownProvider();
    if (provider.recordSessionSummary === undefined) {
      throw new Error("recordSessionSummary not defined");
    }
    // sessions dir doesn't exist yet.
    await expect(stat(join(cwd, ".theokit", "memory", "sessions"))).rejects.toThrow();

    await provider.recordSessionSummary({
      cwd: cwd,
      memoryRoot: resolveMemoryRoot(cwd),
      runId: "first-run",
      agentId: "agent-1",
      userText: "u",
      assistantText: "a",
      status: "finished",
      at: Date.now(),
    });

    // Now the nested path exists.
    const dirStat = await stat(join(cwd, ".theokit", "memory", "sessions"));
    expect(dirStat.isDirectory()).toBe(true);
  });
});
