/**
 * sdk-memory `transcript-store` unit test (iter 58).
 *
 * Validates the iter 58 hybrid copy of
 * `internal/memory/storage/transcript-store.ts` from sdk-core.
 * sdk-memory now ships the canonical optional-on-disk Active Memory
 * transcript writer per ADR D6 that the future `active-memory.ts`
 * move will compose with.
 *
 * sdk-core retains its copy for v1.x active-memory back-compat.
 * Both copies byte-equivalent at runtime (same JSON file path
 * convention `.theokit/memory/transcripts/active-memory/<runId>.json`,
 * same atomicWriteJson backing, same "swallow + stderr warn on
 * failure" semantics).
 *
 * Uses temp-dir + real file I/O (no mocks). Failure path uses a
 * read-only directory to provoke a real disk error; stderr capture
 * verifies the swallow-with-warn contract.
 */

import { chmod, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type ActiveMemoryTranscript,
  persistActiveMemoryTranscript,
  resolveMemoryRoot,
} from "@theokit/sdk-memory";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function sampleTranscript(runId = "run-001"): ActiveMemoryTranscript {
  return {
    runId,
    startedAtMs: Date.UTC(2026, 0, 1),
    userText: "what about caching?",
    queryMode: "message",
    status: "ok",
    durationMs: 12,
    summary: "1 hit",
    hits: [
      {
        path: ".theokit/memory/MEMORY.md",
        startLine: 1,
        endLine: 5,
        score: 0.81,
        snippet: "caching strategy",
      },
    ],
  };
}

describe("sdk-memory transcript-store (iter 58)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "sdk-memory-transcript-"));
  });
  afterEach(async () => {
    // Restore writeability in case a test chmod-locked a dir.
    await chmod(cwd, 0o755).catch(() => undefined);
    await rm(cwd, { recursive: true, force: true });
  });

  it("test_persists_to_expected_path_layout", async () => {
    const tx = sampleTranscript("abc-123");
    await persistActiveMemoryTranscript(resolveMemoryRoot(cwd), tx);

    const expectedFile = join(
      cwd,
      ".theokit",
      "memory",
      "transcripts",
      "active-memory",
      "abc-123.json",
    );
    const raw = await readFile(expectedFile, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.runId).toBe("abc-123");
    expect(parsed.summary).toBe("1 hit");
    expect(parsed.hits.length).toBe(1);
    expect(parsed.hits[0].path).toBe(".theokit/memory/MEMORY.md");
  });

  it("test_creates_parent_directories_automatically", async () => {
    // No `.theokit/memory/transcripts/...` pre-created — the call must
    // mkdir up the chain via atomicWriteJson's parent-dir auto-create.
    await persistActiveMemoryTranscript(resolveMemoryRoot(cwd), sampleTranscript("auto-mk"));
    const dir = join(cwd, ".theokit", "memory", "transcripts", "active-memory");
    const raw = await readFile(join(dir, "auto-mk.json"), "utf8");
    expect(JSON.parse(raw).runId).toBe("auto-mk");
  });

  it("test_swallows_failure_with_stderr_warn", async () => {
    // Force a disk write failure: make the memory parent dir non-writable.
    // atomicWriteJson tries to mkdir under it and fails. The call MUST
    // NOT throw; instead it writes a warning line to stderr.
    const memoryParent = join(cwd, ".theokit");
    await mkdir(memoryParent, { recursive: true });
    await chmod(memoryParent, 0o555); // r-x only, no write

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      // Must not throw.
      await persistActiveMemoryTranscript(resolveMemoryRoot(cwd), sampleTranscript("fail-001"));
      expect(stderrSpy).toHaveBeenCalled();
      const msg = String(stderrSpy.mock.calls[0]?.[0] ?? "");
      expect(msg).toContain("active-memory transcript persist failed");
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("test_transcript_shape_round_trip_preserves_fields", async () => {
    const tx: ActiveMemoryTranscript = {
      runId: "round-trip",
      startedAtMs: 1700000000000,
      userText: "edge case text",
      queryMode: "recent",
      status: "no-recall",
      durationMs: 99,
      summary: undefined,
      hits: [],
    };
    await persistActiveMemoryTranscript(resolveMemoryRoot(cwd), tx);
    const raw = await readFile(
      join(cwd, ".theokit", "memory", "transcripts", "active-memory", "round-trip.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw);
    expect(parsed.runId).toBe("round-trip");
    expect(parsed.queryMode).toBe("recent");
    expect(parsed.status).toBe("no-recall");
    expect(parsed.durationMs).toBe(99);
    // JSON serialization of `undefined` drops the key — pin that behavior.
    expect("summary" in parsed).toBe(false);
    expect(parsed.hits).toEqual([]);
  });
});
