import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { replaceFileAtomic } from "../atomic-write.js";
import { memoryDir } from "../markdown-store.js";

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
 * @internal
 */

export interface DiaryEntry {
  timestampMs: number;
  factsBefore: number;
  factsAfter: number;
  duplicatesRemoved: number;
  clustersCreated: number;
  notesWritten: number;
}

export function diaryPath(cwd: string): string {
  return join(memoryDir(cwd), "dream-diary.md");
}

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

export async function appendDiaryEntry(cwd: string, entry: DiaryEntry): Promise<void> {
  const path = diaryPath(cwd);
  let raw = "";
  try {
    raw = await readFile(path, "utf8");
  } catch {
    raw = "# Dream Diary\n\n";
  }
  const next = `${raw.endsWith("\n") ? raw : `${raw}\n`}${renderDiaryEntry(entry)}`;
  await replaceFileAtomic(path, next);
}

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
