import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { replaceFileAtomic } from "@theokit/sdk/internal/persistence";

import { memoryDir } from "./markdown-store.js";

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
 * Iter 59 (Stage 3 source-move #16): hybrid copy from sdk-core's
 * `internal/memory/dreaming/diary.ts`. sdk-core retains its copy for
 * v1.x dream-diary back-compat; sdk-memory ships the canonical copy
 * that the future `dreaming-run.ts` move will compose with as a
 * sibling (run.ts imports `appendDiaryEntry` after each dreaming
 * sweep). Dependency chain (both resolved):
 * - `@theokit/sdk/internal/persistence` for `replaceFileAtomic`
 * - sibling `./markdown-store.js` for `memoryDir` (moved iter 56)
 *
 * Flat-naming convention (not `dreaming/diary.ts`): sdk-memory's
 * `internal/` directory stays flat. The `dreaming-` prefix preserves
 * the topical grouping (companion to iter 54's `dreaming-phases`).
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
