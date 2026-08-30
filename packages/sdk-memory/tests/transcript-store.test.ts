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
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

  it("test_a_write_failure_is_swallowed_and_never_throws", async () => {
    // Force a disk write failure: make the memory parent dir non-writable. `atomicWriteJson` tries
    // to mkdir under it and fails. The call MUST NOT throw — transcript IO is observability, and
    // observability never breaks the run it merely observes.
    //
    // This used to also assert a line on `process.stderr`. It no longer can, and should not: the
    // shared implementation reports through the SDK's diagnostics sink, which is silent unless the
    // host installs one (#147 — "a library must not assume the host's stdout/stderr are free-form
    // log sinks; in a TUI they are the render surface"). This package's copy predated that and
    // wrote raw stderr; the assertion pinned the copy's staleness. Where the report goes is now the
    // SDK's contract, tested there. What this package still guarantees is the swallow.
    const memoryParent = join(cwd, ".theokit");
    await mkdir(memoryParent, { recursive: true });
    await chmod(memoryParent, 0o555); // r-x only, no write

    await expect(
      persistActiveMemoryTranscript(resolveMemoryRoot(cwd), sampleTranscript("fail-001")),
    ).resolves.toBeUndefined();
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
