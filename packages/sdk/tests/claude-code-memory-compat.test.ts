import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claudeProjectMemoryDir,
  readFactsFromMarkdown,
} from "../src/internal/memory/storage/markdown-store.js";

/*
 * Memories written by the Claude Code CLI.
 *
 * The FORMAT was converged by #389 — same frontmatter, same `MEMORY.md` index. The location never
 * was: the CLI keeps a project's memories at `<claudeHome>/projects/<encoded-cwd>/memory/`, the same
 * `encodeProjectDir` scheme the transcripts use, while this store reads `<cwd>/.theokit/memory`.
 * `markdown-store`'s own header named that path as the target and the ability to reach it was never
 * built, so a memory the CLI wrote was invisible here.
 *
 * Read-side only, and deliberately so: WRITING elsewhere by default would relocate every existing
 * consumer's memories, which is the one thing an additive change must not do.
 */
describe("memories written by the Claude Code CLI", () => {
  let cwd: string;
  let claudeHome: string;
  const savedHome = process.env.CLAUDE_CONFIG_DIR;

  const writeClaudeMemory = (slug: string, body: string): void => {
    const dir = claudeProjectMemoryDir(cwd);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${slug}.md`),
      `---\nname: ${slug}\ndescription: ${slug}\nmetadata:\n  node_type: memory\n  type: project\n---\n\n${body}\n`,
    );
  };

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "cc-mem-cwd-"));
    claudeHome = mkdtempSync(join(tmpdir(), "cc-mem-home-"));
    process.env.CLAUDE_CONFIG_DIR = claudeHome;
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = savedHome;
  });

  it("test_the_cli_project_memory_directory_follows_the_transcript_encoding", () => {
    expect(claudeProjectMemoryDir(cwd)).toBe(
      join(claudeHome, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), "memory"),
    );
  });

  it("test_a_memory_the_cli_wrote_is_read", async () => {
    writeClaudeMemory("do-cli", "The CLI code is CLIMEM-8888.");
    const facts = await readFactsFromMarkdown(cwd);
    expect(facts.map((f) => f.text).join(" ")).toContain("CLIMEM-8888");
  });

  it("test_the_kind_the_cli_declared_survives", async () => {
    writeClaudeMemory("do-cli", "A project fact.");
    const facts = await readFactsFromMarkdown(cwd);
    expect(facts[0]?.kind).toBe("project");
  });

  it("test_memories_from_both_locations_are_read_together", async () => {
    writeClaudeMemory("do-cli", "CLIMEM-8888.");
    mkdirSync(join(cwd, ".theokit", "memory"), { recursive: true });
    writeFileSync(
      join(cwd, ".theokit", "memory", "do-sdk.md"),
      "---\nname: do-sdk\ndescription: do-sdk\nmetadata:\n  node_type: memory\n---\n\nSDKMEM-9999.\n",
    );
    const facts = await readFactsFromMarkdown(cwd);
    const all = facts.map((f) => f.text).join(" ");
    expect(all).toContain("CLIMEM-8888");
    expect(all).toContain("SDKMEM-9999");
  });

  // The accepted case (rules/testing.md § 4.2): a project with no CLI memories at all must still
  // read cleanly, or "nothing there" would have become an error instead of an empty list.
  it("test_a_project_with_no_cli_memories_reads_none", async () => {
    expect(await readFactsFromMarkdown(cwd)).toEqual([]);
  });
});
