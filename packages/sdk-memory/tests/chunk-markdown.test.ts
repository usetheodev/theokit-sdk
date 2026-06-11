/**
 * sdk-memory `chunkMarkdown` unit test (iter 53).
 *
 * Validates the iter 53 hybrid copy of `internal/memory/storage/chunk-markdown.ts`
 * from sdk-core. sdk-memory now ships the canonical
 * heading/paragraph/word-boundary chunker that future `storage/markdown-store`
 * and `index-db` moves will compose with.
 *
 * sdk-core retains its copy for v1.x back-compat.
 * Both copies byte-equivalent at runtime (same algorithm constants:
 * default maxChars=800, 200-char word-boundary walk window).
 *
 * Covers:
 *   - Empty text → []
 *   - Single short paragraph → 1 chunk with full text + line range
 *   - Heading boundary splits into separate chunks; heading carries
 *     to the post-heading chunk
 *   - Blank-line paragraph boundary splits when accumulated > 1 line
 *   - Oversized chunk (> maxChars) → word-boundary split (no
 *     mid-word slice within the 200-char walk window)
 *   - Hash stability (same text → same sha256)
 */

import { chunkMarkdown } from "@theokit/sdk-memory";
import { describe, expect, it } from "vitest";

describe("sdk-memory chunkMarkdown (iter 53)", () => {
  it("test_empty_text_returns_empty_array", () => {
    expect(chunkMarkdown("")).toEqual([]);
  });

  it("test_single_short_paragraph_produces_one_chunk", () => {
    const result = chunkMarkdown("hello world\nfoo bar");
    expect(result.length).toBe(1);
    expect(result[0]?.text).toBe("hello world\nfoo bar");
    expect(result[0]?.startLine).toBe(1);
    expect(result[0]?.endLine).toBe(2);
    expect(result[0]?.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("test_heading_boundary_splits_chunks_and_carries_heading", () => {
    const md = "intro paragraph\n\n# First Heading\nbody one\n\n# Second\nbody two";
    const result = chunkMarkdown(md);
    // Should produce >= 2 chunks (intro + at least one heading-anchored).
    expect(result.length).toBeGreaterThanOrEqual(2);
    // Some chunk after the first heading should carry the heading text.
    const headingsCarried = result.flatMap((c) => (c.heading !== undefined ? [c.heading] : []));
    expect(headingsCarried).toContain("First Heading");
  });

  it("test_blank_line_splits_paragraphs_into_separate_chunks", () => {
    const md = "para one line one\npara one line two\n\npara two line one";
    const result = chunkMarkdown(md);
    expect(result.length).toBe(2);
    expect(result[0]?.text).toContain("para one line one");
    expect(result[1]?.text).toContain("para two line one");
  });

  it("test_oversized_paragraph_splits_on_word_boundary_not_mid_word", () => {
    // Build a 1200-char paragraph of "word " repeated. Default maxChars=800.
    // The algorithm walks backward from maxChars for whitespace and splits
    // THERE — the slice extends up to (but excludes) that whitespace, the
    // next slice starts after the whitespace runs are collapsed via
    // `replace(/^\s+/, "")`. So every chunk's last character is a token
    // character (not whitespace), and the joined chunks reconstruct the
    // exact "word"-sequence without splitting any token mid-letters.
    const single = "word ".repeat(240); // 1200 chars
    const result = chunkMarkdown(single);
    expect(result.length).toBeGreaterThanOrEqual(2);

    // No chunk should end mid-word: after trimming trailing whitespace
    // (last chunk preserves input's trailing space — see chunk-markdown
    // EOF semantics), every chunk's final token is "word". The hard-split
    // fallback only fires when no whitespace exists in the 200-char walk
    // window — never the case for "word " repetition.
    for (const chunk of result) {
      expect(chunk.text.trimEnd().endsWith("word")).toBe(true);
    }

    // Joined+normalized chunks must equal the input minus trailing
    // whitespace runs — i.e., the algorithm doesn't lose any word and
    // doesn't split any word.
    const rejoined = result.map((c) => c.text.trim()).join(" ");
    const inputTrimmed = single.trim();
    expect(rejoined).toBe(inputTrimmed);
  });

  it("test_hash_is_stable_for_identical_text", () => {
    const a = chunkMarkdown("hello world");
    const b = chunkMarkdown("hello world");
    expect(a[0]?.hash).toBe(b[0]?.hash);
  });

  it("test_options_maxChars_override_honored", () => {
    // With maxChars=10 a 30-char input must split into ≥ 3 chunks
    // (algorithm splits oversize on word boundary; "abcdefghij " has
    // a whitespace at index 10 so this is well-behaved).
    const md = "abcdefghij abcdefghij abcdefghij";
    const result = chunkMarkdown(md, { maxChars: 10 });
    expect(result.length).toBeGreaterThanOrEqual(3);
  });

  it("test_single_heading_only_input_emits_chunk_with_heading", () => {
    const md = "# Lone Heading";
    const result = chunkMarkdown(md);
    expect(result.length).toBe(1);
    expect(result[0]?.heading).toBe("Lone Heading");
    expect(result[0]?.text).toBe("# Lone Heading");
  });
});
