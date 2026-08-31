/**
 * sdk-memory `dreaming-diary` unit test (iter 59).
 *
 * Validates the iter 59 hybrid copy of
 * `internal/memory/dreaming/diary.ts` from sdk-core. sdk-memory now
 * ships the canonical dream-diary writer per ADR D7 that the future
 * `dreaming-run.ts` move (post-sweep summary) will compose with.
 *
 * sdk-core retains its copy for v1.x dream-diary back-compat.
 * Both copies byte-equivalent at runtime (same diary file path
 * `.theokit/memory/dream-diary.md`, same ISO timestamp + 8-char
 * sha256 entry-hash header, same markdown rendering shape, same
 * atomic-write semantics).
 *
 * Uses temp-dir + real file I/O (no mocks) per the no-stubs canon.
 */

import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendDiaryEntry,
  type DiaryEntry,
  diaryPath,
  entryHash,
  renderDiaryEntry,
  resolveMemoryRoot,
} from "@theokit/sdk-memory";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function sampleEntry(overrides: Partial<DiaryEntry> = {}): DiaryEntry {
  return {
    timestampMs: Date.UTC(2026, 0, 1, 12, 0, 0),
    factsBefore: 10,
    factsAfter: 7,
    duplicatesRemoved: 3,
    clustersCreated: 2,
    notesWritten: 1,
    ...overrides,
  };
}

describe("sdk-memory dreaming-diary (iter 59)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "sdk-memory-diary-"));
    // appendDiaryEntry requires memoryDir to exist (sdk-core canonical
    // contract: dreaming-run mkdirs notesDir recursively BEFORE calling
    // appendDiaryEntry, and notesDir's parent is memoryDir — so the
    // diary's parent is guaranteed before this function runs). Mirror
    // that contract in the test setup.
    await mkdir(resolveMemoryRoot(cwd), { recursive: true });
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  describe("diaryPath", () => {
    it("test_resolves_to_dot_theokit_memory_dream_diary_md", () => {
      expect(diaryPath(resolveMemoryRoot(cwd))).toBe(
        join(cwd, ".theokit", "memory", "dream-diary.md"),
      );
    });
  });

  describe("entryHash", () => {
    it("test_identical_input_produces_identical_hash", () => {
      const a = entryHash(sampleEntry());
      const b = entryHash(sampleEntry());
      expect(a).toBe(b);
      expect(a).toMatch(/^[a-f0-9]{64}$/);
    });

    it("test_different_input_produces_different_hash", () => {
      const a = entryHash(sampleEntry());
      const b = entryHash(sampleEntry({ duplicatesRemoved: 99 }));
      expect(a).not.toBe(b);
    });

    it("test_hash_excludes_timestamp_idempotent_across_clocks", () => {
      // The canonical sdk-core copy hashes only the counts (factsBefore
      // + factsAfter + duplicatesRemoved + clustersCreated + notesWritten)
      // — NOT the timestamp. This means two sweeps at different times
      // producing identical counts share an entry-hash (idempotency
      // contract). Pin that behavior.
      const morningEntry = sampleEntry({ timestampMs: Date.UTC(2026, 0, 1, 9) });
      const eveningEntry = sampleEntry({ timestampMs: Date.UTC(2026, 0, 1, 21) });
      expect(entryHash(morningEntry)).toBe(entryHash(eveningEntry));
    });
  });

  describe("renderDiaryEntry", () => {
    it("test_renders_iso_timestamp_header_and_count_bullets", () => {
      const md = renderDiaryEntry(sampleEntry());
      expect(md).toContain("## 2026-01-01T12:00:00.000Z");
      expect(md).toContain("- entry-hash: ");
      expect(md).toContain("- facts before: 10");
      expect(md).toContain("- facts after: 7");
      expect(md).toContain("- duplicates removed: 3");
      expect(md).toContain("- clusters created: 2");
      expect(md).toContain("- notes written: 1");
    });

    it("test_entry_hash_in_render_is_8_char_prefix_of_full_hash", () => {
      const e = sampleEntry();
      const md = renderDiaryEntry(e);
      const full = entryHash(e);
      const matched = /entry-hash: ([a-f0-9]+)/.exec(md);
      expect(matched).not.toBeNull();
      expect(matched?.[1]).toBe(full.slice(0, 8));
    });
  });

  describe("appendDiaryEntry", () => {
    it("test_creates_file_with_header_on_first_append", async () => {
      await appendDiaryEntry(resolveMemoryRoot(cwd), sampleEntry());
      const raw = await readFile(diaryPath(resolveMemoryRoot(cwd)), "utf8");
      expect(raw).toContain("# Dream Diary");
      expect(raw).toContain("## 2026-01-01T12:00:00.000Z");
    });

    it("test_appends_to_existing_diary", async () => {
      await appendDiaryEntry(
        resolveMemoryRoot(cwd),
        sampleEntry({ timestampMs: Date.UTC(2026, 0, 1) }),
      );
      await appendDiaryEntry(
        resolveMemoryRoot(cwd),
        sampleEntry({ timestampMs: Date.UTC(2026, 0, 2) }),
      );
      await appendDiaryEntry(
        resolveMemoryRoot(cwd),
        sampleEntry({ timestampMs: Date.UTC(2026, 0, 3) }),
      );

      const raw = await readFile(diaryPath(resolveMemoryRoot(cwd)), "utf8");
      expect(raw).toContain("2026-01-01");
      expect(raw).toContain("2026-01-02");
      expect(raw).toContain("2026-01-03");
      // Only one header line.
      expect(raw.match(/# Dream Diary/g)?.length).toBe(1);
    });

    it("test_diary_ends_with_newline_after_append", async () => {
      await appendDiaryEntry(resolveMemoryRoot(cwd), sampleEntry());
      const raw = await readFile(diaryPath(resolveMemoryRoot(cwd)), "utf8");
      expect(raw.endsWith("\n")).toBe(true);
    });
  });
});
