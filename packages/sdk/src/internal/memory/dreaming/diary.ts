import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { replaceFileAtomic } from "../../persistence/atomic-write.js";
import type { MemoryRoot } from "../storage/memory-root.js";

/**
 * Dream-diary append (ADR D7).
 *
 * Diary lives at `.theokit/memory/dream-diary.md` and grows with one entry
 * per sweep. Each entry is content-hashed so the same input produces the
 * same entry — idempotency contract.
 *
 * Writes go through `replaceFileAtomic` (EC-3 of edge-case review) so a
 * crash mid-write can never leave a half-written diary.
 *
 * Shared with `@theokit/sdk-memory`; see the memory-store barrel.
 */

export interface DiaryEntry {
  timestampMs: number;
  factsBefore: number;
  factsAfter: number;
  duplicatesRemoved: number;
  clustersCreated: number;
  notesWritten: number;
}

/** `<memory root>/dream-diary.md`. Takes the RESOLVED ROOT — see `storage/memory-root.ts` (#463). */
export function diaryPath(root: MemoryRoot): string {
  return join(root, "dream-diary.md");
}

/**
 * One diary entry as the markdown that gets appended: a timestamp heading, the short entry hash,
 * and the counts the sweep produced. The hash is what makes a re-run recognisable as the same
 * sweep rather than a new one.
 */
export function renderDiaryEntry(entry: DiaryEntry): string {
  const stamp = new Date(entry.timestampMs).toISOString();
  const hash = entryHash(entry).slice(0, 8);
  return [
    `## ${stamp}`,
    "",
    `- entry-hash: ${hash}`,
    `- facts before: ${entry.factsBefore}`,
    `- facts after: ${entry.factsAfter}`,
    `- duplicates removed: ${entry.duplicatesRemoved}`,
    `- clusters created: ${entry.clustersCreated}`,
    `- notes written: ${entry.notesWritten}`,
    "",
  ].join("\n");
}

/**
 * Append one sweep's entry to `<memory root>/dream-diary.md`, creating the file with its header
 * when this is the first sweep. The diary is a human-readable record of what dreaming changed —
 * consolidations are otherwise invisible, because they alter the notes rather than announce
 * themselves.
 */
export async function appendDiaryEntry(root: MemoryRoot, entry: DiaryEntry): Promise<void> {
  const path = diaryPath(root);
  let raw = "";
  try {
    raw = await readFile(path, "utf8");
  } catch {
    raw = "# Dream Diary\n\n";
  }
  const next = `${raw.endsWith("\n") ? raw : `${raw}\n`}${renderDiaryEntry(entry)}`;
  await replaceFileAtomic(path, next);
}

/**
 * A stable hash of one entry's counts, so two sweeps that did the same work read as the same work.
 * Rendered truncated in the entry; the full value is what callers compare.
 */
export function entryHash(entry: DiaryEntry): string {
  return createHash("sha256")
    .update(
      [
        entry.factsBefore,
        entry.factsAfter,
        entry.duplicatesRemoved,
        entry.clustersCreated,
        entry.notesWritten,
      ].join("|"),
    )
    .digest("hex");
}
