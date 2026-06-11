/**
 * sdk-memory `markdown-store` unit test (iter 56).
 *
 * Validates the iter 56 hybrid copy of
 * `internal/memory/storage/markdown-store.ts` from sdk-core.
 * sdk-memory now ships the canonical markdown-first storage that
 * future `tools.ts`, `dreaming-diary`, `dreaming-run`,
 * `session-loader`, `session-summary-writer`, `transcript-store`,
 * `wiki-loader`, `migration` moves will all compose with.
 *
 * sdk-core retains its copy for v1.x markdown-first memory back-compat.
 * Both copies byte-equivalent at runtime (same MEMORY.md schema:
 * `# Memory` header + `## Facts` bulleted list, same parse rule
 * "next h1/h2 stops the facts block", same atomic + per-cwd-mutex
 * serialization).
 *
 * Uses temp-dir + real file I/O (no mocks) per the no-stubs canon.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendFact,
  appendFactToMarkdown,
  listNotes,
  type MemoryConfig,
  memoryDir,
  memoryMdPath,
  type NoteFile,
  notesDir,
  readFacts,
  readFactsFromMarkdown,
} from "@theokit/sdk-memory";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("sdk-memory markdown-store (iter 56)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "sdk-memory-mdstore-"));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  describe("path helpers", () => {
    it("test_memoryDir_returns_dot_theokit_memory", () => {
      expect(memoryDir(cwd)).toBe(join(cwd, ".theokit", "memory"));
    });
    it("test_memoryMdPath_returns_MEMORY_md_inside_dir", () => {
      expect(memoryMdPath(cwd)).toBe(join(cwd, ".theokit", "memory", "MEMORY.md"));
    });
    it("test_notesDir_returns_notes_inside_dir", () => {
      expect(notesDir(cwd)).toBe(join(cwd, ".theokit", "memory", "notes"));
    });
  });

  describe("readFactsFromMarkdown", () => {
    it("test_returns_empty_when_no_file", async () => {
      const facts = await readFactsFromMarkdown(cwd);
      expect(facts).toEqual([]);
    });

    it("test_returns_facts_from_bullet_list", async () => {
      const content = "# Memory\n\n## Facts\n\n- one\n- two\n- three\n";
      await mkdir(memoryDir(cwd), { recursive: true });
      await writeFile(memoryMdPath(cwd), content);

      const facts = await readFactsFromMarkdown(cwd);
      expect(facts).toEqual([{ text: "one" }, { text: "two" }, { text: "three" }]);
    });

    it("test_stops_at_next_h2_heading", async () => {
      const content = "# Memory\n\n## Facts\n\n- inside\n\n## Other Section\n\n- outside\n";
      await mkdir(memoryDir(cwd), { recursive: true });
      await writeFile(memoryMdPath(cwd), content);

      const facts = await readFactsFromMarkdown(cwd);
      expect(facts.map((f) => f.text)).toEqual(["inside"]);
    });
  });

  describe("appendFactToMarkdown", () => {
    it("test_creates_file_with_header_and_facts_section", async () => {
      await appendFactToMarkdown(cwd, { text: "first fact" });
      const raw = await readFile(memoryMdPath(cwd), "utf8");
      expect(raw).toContain("# Memory");
      expect(raw).toContain("## Facts");
      expect(raw).toContain("- first fact");
    });

    it("test_appends_to_existing_facts_section", async () => {
      await appendFactToMarkdown(cwd, { text: "one" });
      await appendFactToMarkdown(cwd, { text: "two" });
      await appendFactToMarkdown(cwd, { text: "three" });

      const facts = await readFactsFromMarkdown(cwd);
      expect(facts.map((f) => f.text)).toEqual(["one", "two", "three"]);
    });

    it("test_redacts_secrets_before_persist", async () => {
      const FAKE_KEY = "sk-proj-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
      await appendFactToMarkdown(cwd, { text: `api key is ${FAKE_KEY}` });

      const raw = await readFile(memoryMdPath(cwd), "utf8");
      expect(raw).not.toContain(FAKE_KEY);
      expect(raw).toContain("api key is");
    });
  });

  describe("config-aware accessors", () => {
    it("test_readFacts_returns_empty_when_disabled", async () => {
      await appendFactToMarkdown(cwd, { text: "still here" });
      const cfg: MemoryConfig = { enabled: false };
      expect(await readFacts(cwd, cfg)).toEqual([]);
    });

    it("test_readFacts_returns_facts_when_enabled", async () => {
      await appendFactToMarkdown(cwd, { text: "hello" });
      const cfg: MemoryConfig = { enabled: true };
      const result = await readFacts(cwd, cfg);
      expect(result.map((f) => f.text)).toEqual(["hello"]);
    });

    it("test_appendFact_skips_when_disabled", async () => {
      const cfg: MemoryConfig = { enabled: false };
      await appendFact(cwd, cfg, { text: "should not land" });
      const raw = await readFactsFromMarkdown(cwd);
      expect(raw).toEqual([]);
    });
  });

  describe("listNotes", () => {
    it("test_returns_empty_when_no_notes_dir", async () => {
      const notes: NoteFile[] = await listNotes(cwd);
      expect(notes).toEqual([]);
    });

    it("test_returns_only_markdown_files_with_slugs", async () => {
      await mkdir(notesDir(cwd), { recursive: true });
      await writeFile(join(notesDir(cwd), "foo.md"), "foo");
      await writeFile(join(notesDir(cwd), "bar.md"), "bar");
      await writeFile(join(notesDir(cwd), "baz.txt"), "ignored");

      const notes = await listNotes(cwd);
      const slugs = notes.map((n) => n.slug).sort();
      expect(slugs).toEqual(["bar", "foo"]);
    });
  });

  describe("concurrent appends serialize via per-cwd mutex", () => {
    it("test_10_parallel_appends_preserve_all_facts", async () => {
      const inputs = Array.from({ length: 10 }, (_, i) => `parallel-${i}`);
      await Promise.all(inputs.map((text) => appendFactToMarkdown(cwd, { text })));

      const facts = await readFactsFromMarkdown(cwd);
      const got = facts.map((f) => f.text).sort();
      expect(got).toEqual(inputs.sort());
    });
  });
});
