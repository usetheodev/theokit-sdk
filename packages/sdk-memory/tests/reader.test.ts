/**
 * sdk-memory `readMemoryFileBounded` unit test (iter 55).
 *
 * Validates the iter 55 hybrid copy of
 * `internal/memory/storage/reader.ts` from sdk-core. sdk-memory now
 * ships the canonical bounded-read with truncation info that future
 * `memory_get` LLM tool move (tools.ts) will compose with.
 *
 * sdk-core retains its copy for v1.x back-compat.
 * Both copies byte-equivalent at runtime (same trailing-newline
 * trim rule, same 1-indexed `from`, same 200-line default, same
 * truncated=remainingLines>0 semantics).
 *
 * Uses temp-dir + real file I/O (no mocks) per the no-mock canon.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_MEMORY_READ_LINES,
  readMemoryFileBounded,
} from "@theokit/sdk-memory";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("sdk-memory readMemoryFileBounded (iter 55)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "sdk-memory-reader-"));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("test_DEFAULT_MEMORY_READ_LINES_pinned_to_200", () => {
    expect(DEFAULT_MEMORY_READ_LINES).toBe(200);
  });

  it("test_reads_entire_file_when_within_default_window", async () => {
    const content = ["alpha", "beta", "gamma"].join("\n");
    await writeFile(join(cwd, "small.md"), content);

    const res = await readMemoryFileBounded({ cwd, relPath: "small.md" });
    expect(res.totalLines).toBe(3);
    expect(res.linesReturned).toBe(3);
    expect(res.truncated).toBe(false);
    expect(res.remainingLines).toBe(0);
    expect(res.text).toBe(content);
    expect(res.from).toBe(1);
  });

  it("test_strips_trailing_newline_from_total_lines", async () => {
    // A file ending with \n should report editor-visible line count, not
    // byte-level split count.
    const content = "alpha\nbeta\n";
    await writeFile(join(cwd, "trailing.md"), content);

    const res = await readMemoryFileBounded({ cwd, relPath: "trailing.md" });
    expect(res.totalLines).toBe(2);
    expect(res.linesReturned).toBe(2);
    expect(res.text).toBe("alpha\nbeta");
  });

  it("test_honors_from_1_indexed_with_slice", async () => {
    const content = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join("\n");
    await writeFile(join(cwd, "ten.md"), content);

    const res = await readMemoryFileBounded({
      cwd,
      relPath: "ten.md",
      from: 4,
      lines: 3,
    });
    expect(res.from).toBe(4);
    expect(res.linesReturned).toBe(3);
    expect(res.text).toBe(["line4", "line5", "line6"].join("\n"));
    expect(res.totalLines).toBe(10);
    expect(res.remainingLines).toBe(4); // line7..line10
    expect(res.truncated).toBe(true);
  });

  it("test_truncated_false_at_EOF_even_if_fewer_lines_returned", async () => {
    const content = Array.from({ length: 5 }, (_, i) => `line${i + 1}`).join("\n");
    await writeFile(join(cwd, "five.md"), content);

    // Ask for 100 lines starting at line 3 — EOF will cut short.
    const res = await readMemoryFileBounded({
      cwd,
      relPath: "five.md",
      from: 3,
      lines: 100,
    });
    expect(res.linesReturned).toBe(3);
    expect(res.totalLines).toBe(5);
    expect(res.remainingLines).toBe(0);
    expect(res.truncated).toBe(false);
  });

  it("test_clamps_from_below_1", async () => {
    await writeFile(join(cwd, "a.md"), "one\ntwo");
    const res = await readMemoryFileBounded({ cwd, relPath: "a.md", from: 0 });
    expect(res.from).toBe(1);
  });

  it("test_clamps_lines_below_1", async () => {
    await writeFile(join(cwd, "b.md"), "one\ntwo\nthree");
    const res = await readMemoryFileBounded({
      cwd,
      relPath: "b.md",
      lines: 0,
    });
    // lines clamps to 1 → returns 1 line.
    expect(res.linesReturned).toBe(1);
    expect(res.text).toBe("one");
  });

  it("test_returns_relative_path_in_result", async () => {
    await writeFile(join(cwd, "test.md"), "hi");
    const res = await readMemoryFileBounded({ cwd, relPath: "test.md" });
    expect(res.path).toBe("test.md");
  });
});
