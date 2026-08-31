/**
 * sdk-memory `session-loader` unit test (iter 62).
 *
 * Validates the iter 62 hybrid copy of
 * `internal/memory/storage/session-loader.ts` from sdk-core.
 * sdk-memory now ships the canonical session summary discovery.
 *
 * sdk-core retains its copy for v1.x sessions back-compat.
 * Both copies byte-equivalent at runtime (same shallow *.md filter,
 * same root-relative relPath convention `sessions/<file>.md`).
 *
 * Uses temp-dir + real file I/O (no mocks) per the no-stubs canon.
 * The writer side is exercised via the `writeSessionSummary` public
 * surface from iter 61 to keep the test end-to-end (write then
 * discover) — no manual mkdir + writeFile of fake summaries.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  discoverSessionFiles,
  resolveMemoryRoot,
  type SessionFile,
  sessionsDir,
  writeSessionSummary,
} from "@theokit/sdk-memory";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("sdk-memory session-loader (iter 62)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "sdk-memory-session-loader-"));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("test_returns_empty_when_sessions_dir_absent", async () => {
    const result = await discoverSessionFiles(resolveMemoryRoot(cwd));
    expect(result).toEqual([]);
  });

  it("test_returns_empty_when_sessions_dir_present_but_empty", async () => {
    await mkdir(sessionsDir(resolveMemoryRoot(cwd)), { recursive: true });
    const result = await discoverSessionFiles(resolveMemoryRoot(cwd));
    expect(result).toEqual([]);
  });

  it("test_returns_md_files_with_sessions_prefixed_relPath", async () => {
    // Use the iter 61 writer to seed two finished sessions — end-to-end.
    await writeSessionSummary({
      memoryRoot: resolveMemoryRoot(cwd),
      runId: "alpha",
      agentId: "test",
      userText: "hi",
      assistantText: "hello",
      status: "finished",
      at: Date.UTC(2026, 0, 1),
    });
    await writeSessionSummary({
      memoryRoot: resolveMemoryRoot(cwd),
      runId: "beta",
      agentId: "test",
      userText: "again",
      assistantText: "again",
      status: "finished",
      at: Date.UTC(2026, 0, 2),
    });

    const result: SessionFile[] = await discoverSessionFiles(resolveMemoryRoot(cwd));
    const sorted = [...result].sort((a, b) => a.relPath.localeCompare(b.relPath));
    expect(sorted.length).toBe(2);
    expect(sorted[0]?.relPath).toBe("sessions/alpha.md");
    expect(sorted[1]?.relPath).toBe("sessions/beta.md");
    expect(sorted[0]?.absolutePath).toBe(join(sessionsDir(resolveMemoryRoot(cwd)), "alpha.md"));
    expect(sorted[1]?.absolutePath).toBe(join(sessionsDir(resolveMemoryRoot(cwd)), "beta.md"));
  });

  it("test_filters_out_non_markdown_files", async () => {
    await mkdir(sessionsDir(resolveMemoryRoot(cwd)), { recursive: true });
    await writeFile(join(sessionsDir(resolveMemoryRoot(cwd)), "keep.md"), "kept");
    await writeFile(join(sessionsDir(resolveMemoryRoot(cwd)), "skip.txt"), "skipped");
    await writeFile(join(sessionsDir(resolveMemoryRoot(cwd)), "skip.json"), "{}");

    const result = await discoverSessionFiles(resolveMemoryRoot(cwd));
    expect(result.length).toBe(1);
    expect(result[0]?.relPath).toBe("sessions/keep.md");
  });

  it("test_does_not_recurse_into_subdirectories", async () => {
    // session-loader uses readdir without recursion — same shallow
    // behavior as iter 57's wiki-loader. Files in nested subdirs
    // are intentionally NOT returned.
    await mkdir(join(sessionsDir(resolveMemoryRoot(cwd)), "deep"), { recursive: true });
    await writeFile(join(sessionsDir(resolveMemoryRoot(cwd)), "deep", "buried.md"), "deep");
    await writeFile(join(sessionsDir(resolveMemoryRoot(cwd)), "top.md"), "top");

    const result = await discoverSessionFiles(resolveMemoryRoot(cwd));
    expect(result.length).toBe(1);
    expect(result[0]?.relPath).toBe("sessions/top.md");
  });

  it("test_skipped_sessions_from_writer_do_not_appear", async () => {
    // EC-9 gate enforced by writer: only finished runs land on disk.
    // The loader should not have any non-finished sessions to discover.
    await writeSessionSummary({
      memoryRoot: resolveMemoryRoot(cwd),
      runId: "fin",
      agentId: "test",
      userText: "ok",
      assistantText: "ok",
      status: "finished",
      at: Date.UTC(2026, 0, 1),
    });
    await writeSessionSummary({
      memoryRoot: resolveMemoryRoot(cwd),
      runId: "skipped",
      agentId: "test",
      userText: "no",
      assistantText: "no",
      status: "cancelled",
      at: Date.UTC(2026, 0, 2),
    });

    const result = await discoverSessionFiles(resolveMemoryRoot(cwd));
    expect(result.length).toBe(1);
    expect(result[0]?.relPath).toBe("sessions/fin.md");
  });
});
