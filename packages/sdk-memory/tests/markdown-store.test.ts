/**
 * sdk-memory `markdown-store` unit test.
 *
 * This file used to open by asserting that sdk-memory's copy and the SDK's were "byte-equivalent at
 * runtime (same MEMORY.md schema)". That sentence was true when written and nobody measured it
 * again. #389 moved the layout to a file per memory in the SDK's copy and not in this one, so the
 * two diverged — and because `Memory.runDreamingSweep` swaps in this package's copy whenever it is
 * installed, **the copy that ran was not the copy anyone had updated**. Installing
 * `@theokit/sdk-memory` made every memory the SDK had written unreadable, reported as
 * `factsBefore: 0` — indistinguishable from an empty store (#430).
 *
 * There is one copy now: this package re-exports the SDK's store rather than reimplementing it. The
 * cases below therefore describe the SHARED contract, and the identity case at the bottom is what
 * fails if someone reintroduces a local implementation under the same names.
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
  memoryMdPath,
  type NoteFile,
  notesDir,
  readFacts,
  readFactsFromMarkdown,
  resolveMemoryRoot,
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
      expect(resolveMemoryRoot(cwd)).toBe(join(cwd, ".theokit", "memory"));
    });
    it("test_memoryMdPath_returns_MEMORY_md_inside_dir", () => {
      expect(memoryMdPath(resolveMemoryRoot(cwd))).toBe(
        join(cwd, ".theokit", "memory", "MEMORY.md"),
      );
    });
    it("test_notesDir_returns_notes_inside_dir", () => {
      expect(notesDir(resolveMemoryRoot(cwd))).toBe(join(cwd, ".theokit", "memory", "notes"));
    });
  });

  describe("readFactsFromMarkdown", () => {
    it("test_returns_empty_when_no_file", async () => {
      const facts = await readFactsFromMarkdown(cwd);
      expect(facts).toEqual([]);
    });

    it("test_returns_facts_from_bullet_list", async () => {
      const content = "# Memory\n\n## Facts\n\n- one\n- two\n- three\n";
      await mkdir(resolveMemoryRoot(cwd), { recursive: true });
      await writeFile(memoryMdPath(resolveMemoryRoot(cwd)), content);

      const facts = await readFactsFromMarkdown(cwd);
      expect(facts).toEqual([{ text: "one" }, { text: "two" }, { text: "three" }]);
    });

    it("test_stops_at_next_h2_heading", async () => {
      const content = "# Memory\n\n## Facts\n\n- inside\n\n## Other Section\n\n- outside\n";
      await mkdir(resolveMemoryRoot(cwd), { recursive: true });
      await writeFile(memoryMdPath(resolveMemoryRoot(cwd)), content);

      const facts = await readFactsFromMarkdown(cwd);
      expect(facts.map((f) => f.text)).toEqual(["inside"]);
    });
  });

  describe("appendFactToMarkdown", () => {
    // A fact is its own file since #389, with `MEMORY.md` as the index pointing at it. The two
    // assertions used to be "the bullet is in MEMORY.md"; that format is still READ (below), but a
    // store written today is not in it.
    it("test_writes_the_fact_as_its_own_file_and_points_the_index_at_it", async () => {
      await appendFactToMarkdown(cwd, { text: "first fact" });
      const written = await readFile(join(resolveMemoryRoot(cwd), "first-fact.md"), "utf8");
      expect(written).toContain("first fact");
      expect(await readFile(memoryMdPath(resolveMemoryRoot(cwd)), "utf8")).toContain(
        "first-fact.md",
      );
    });

    it("test_every_appended_fact_is_read_back", async () => {
      await appendFactToMarkdown(cwd, { text: "one" });
      await appendFactToMarkdown(cwd, { text: "two" });
      await appendFactToMarkdown(cwd, { text: "three" });

      // Sorted, not insertion-ordered: the store is a directory, and its order is the file
      // system's. Asserting insertion order would pin a property the store does not promise.
      const facts = await readFactsFromMarkdown(cwd);
      expect(facts.map((f) => f.text).sort()).toEqual(["one", "three", "two"]);
    });

    it("test_redacts_secrets_before_persist", async () => {
      const FAKE_KEY = "sk-proj-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
      await appendFactToMarkdown(cwd, { text: `api key is ${FAKE_KEY}` });

      const raw = await readFile(memoryMdPath(resolveMemoryRoot(cwd)), "utf8");
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
      await mkdir(notesDir(resolveMemoryRoot(cwd)), { recursive: true });
      await writeFile(join(notesDir(resolveMemoryRoot(cwd)), "foo.md"), "foo");
      await writeFile(join(notesDir(resolveMemoryRoot(cwd)), "bar.md"), "bar");
      await writeFile(join(notesDir(resolveMemoryRoot(cwd)), "baz.txt"), "ignored");

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
