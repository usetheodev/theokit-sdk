import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { replaceFileAtomic } from "@theokit/sdk/persistence";

import type { MemoryRoot } from "../store/markdown-store.js";

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
 * - `@theokit/sdk/persistence` for `replaceFileAtomic`
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

/** Path to the dream diary, `<memory root>/dream-diary.md`. Pure path computation. */
export function diaryPath(root: MemoryRoot): string {
  return join(root, "dream-diary.md");
}

/**
 * Render one entry as the markdown block {@link appendDiaryEntry} writes: an h2
 * heading carrying the ISO timestamp, then a bullet list of the counts, prefixed
 * by the first eight hex characters of {@link entryHash}.
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
 * Append one entry to the dream diary, creating the file with a `# Dream Diary`
 * header when it does not exist yet. The whole file is rewritten through an
 * atomic replace, so a crash mid-write leaves the previous diary intact rather
 * than a truncated one.
 *
 * The parent directory is not created here. Call this against a workspace whose
 * memory directory already exists — a dreaming sweep does, because it has just
 * read `MEMORY.md` from it.
 *
 * Appending is unconditional: passing an entry that was already written adds a
 * second block. The hash identifies repeated content, it does not suppress it.
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
 * A sha256 over the five counts of an entry, as a hex string.
 *
 * The timestamp is deliberately NOT part of the hash, so two sweeps that changed
 * nothing produce the same hash at different times — that is the signal the
 * diary is meant to carry. It also means the hash does not identify an entry
 * uniquely.
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
