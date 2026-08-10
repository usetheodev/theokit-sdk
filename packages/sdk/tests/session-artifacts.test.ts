/**
 * U-1 (scoped) — the SDK recognises the files it leaves in a project directory.
 *
 * It creates four kinds and reasons about none of them afterwards: `<id>.jsonl` (transcriptPath),
 * `<id>.jsonl.writer.lock` (session-writer), `<id>.jsonl.lock` (withFileLock), and
 * `<file>.<pid>.<hex>.tmp` (replaceFileAtomic, on a crash). There is no retention, no collector, and
 * — until now — no way even to ask what a given entry IS.
 *
 * So a consumer wanting to reclaim disk had to re-derive the suffixes by reading the SDK's source,
 * which is what TheoCode did (finding PS-012). A suffix changing upstream would have left that
 * classifier silently mislabelling files on a path that deletes them.
 *
 * DELIBERATELY NOT a garbage collector. Retention is policy — how many days, how many to keep, which
 * session is live, whether to delete at all — and policy belongs to the application, which is the
 * only one that knows. What belongs here is the half only the SDK can answer: what did I write, and
 * what is it. The consumer's plan/apply, age floor and live-session guards stay where they are.
 */
import { describe, expect, it } from "vitest";

import { classifySessionArtifact } from "../src/persistence.js";

describe("U-1 — the SDK classifies its own artifacts", () => {
  it("test_a_transcript_is_recognised", () => {
    expect(classifySessionArtifact("sess-1.jsonl", false)).toBe("transcript");
  });

  it("test_a_writer_lock_is_recognised", () => {
    expect(classifySessionArtifact("sess-1.jsonl.writer.lock", false)).toBe("writer-lock");
  });

  it("test_a_lock_directory_is_recognised_only_as_a_directory", () => {
    // withFileLock takes the lock by mkdir, so the same name as a FILE is not one of ours.
    expect(classifySessionArtifact("sess-1.jsonl.lock", true)).toBe("lock-directory");
    expect(classifySessionArtifact("sess-1.jsonl.lock", false)).toBeUndefined();
  });

  it("test_an_atomic_write_temp_is_recognised", () => {
    expect(classifySessionArtifact("sess-1.jsonl.4242.00112233445566aa.tmp", false)).toBe("temp");
  });

  it("test_a_foreign_temp_is_not_claimed", () => {
    // Anti-vacuity floor: claiming any `.tmp` would hand an editor's swap file to a deleter.
    expect(classifySessionArtifact("vim-swap.tmp", false)).toBeUndefined();
    expect(classifySessionArtifact("sess-1.jsonl.notapid.beef.tmp", false)).toBeUndefined();
  });

  it("test_an_unrelated_file_is_not_claimed", () => {
    expect(classifySessionArtifact("README.md", false)).toBeUndefined();
    expect(classifySessionArtifact("subdir", true)).toBeUndefined();
  });
});
