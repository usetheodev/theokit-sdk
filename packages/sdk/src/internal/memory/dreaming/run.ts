import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { replaceFileAtomic } from "../atomic-write.js";
import { withCwdMutex } from "../cwd-mutex.js";
import type { EmbeddingRuntime } from "../embedding-adapter.js";
import { memoryDir, readFactsFromMarkdown } from "../markdown-store.js";
import { appendDiaryEntry } from "./diary.js";
import { deepPhase, lightPhase, remPhase } from "./phases.js";

/**
 * Dreaming sweep orchestrator (ADR D7 of memory-system-openclaw-parity).
 *
 * Phases:
 *   1. **light** — drop near-duplicate facts via cosine similarity.
 *   2. **REM**  — cluster thematically related facts.
 *   3. **deep** — write a `notes/dreamed-<ts>.md` per sweep with consolidated
 *                  clusters; append a diary entry.
 *
 * All file writes go through `replaceFileAtomic` (EC-3) and the entire sweep
 * holds the per-cwd mutex so a `Remember:` append can't race it.
 *
 * @internal
 */

export interface DreamingOptions {
  cwd: string;
  embedding: EmbeddingRuntime;
  dedupThreshold?: number;
  clusterThreshold?: number;
  /** Test hook — fixed timestamp for the run. */
  now?: () => number;
}

export interface DreamingResult {
  status: "ok" | "skipped" | "error";
  factsBefore: number;
  factsAfter: number;
  duplicatesRemoved: number;
  clustersCreated: number;
  notesWritten: number;
  diaryEntryHash: string | undefined;
}

export function runDreamingSweep(options: DreamingOptions): Promise<DreamingResult> {
  return withCwdMutex(`dream:${options.cwd}`, () => runInner(options));
}

async function runInner(options: DreamingOptions): Promise<DreamingResult> {
  const now = options.now ?? Date.now;
  const timestampMs = now();
  try {
    const facts = await readFactsFromMarkdown(options.cwd);
    if (facts.length === 0) {
      return emptyResult("skipped");
    }
    const dedup = await lightPhase(facts, options.embedding, options.dedupThreshold);
    const rem = await remPhase(dedup.kept, options.embedding, options.clusterThreshold);
    const notesWritten = await writeConsolidatedNotes(options.cwd, rem.clusters, timestampMs);
    const result: DreamingResult = {
      status: "ok",
      factsBefore: facts.length,
      factsAfter: dedup.kept.length,
      duplicatesRemoved: dedup.duplicatesRemoved,
      clustersCreated: rem.clusters.length,
      notesWritten,
      diaryEntryHash: undefined,
    };
    await appendDiaryEntry(options.cwd, {
      timestampMs,
      factsBefore: result.factsBefore,
      factsAfter: result.factsAfter,
      duplicatesRemoved: result.duplicatesRemoved,
      clustersCreated: result.clustersCreated,
      notesWritten: result.notesWritten,
    });
    return result;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`[theokit-sdk] dreaming sweep failed: ${message}\n`);
    return emptyResult("error");
  }
}

async function writeConsolidatedNotes(
  cwd: string,
  clusters: ReadonlyArray<{ representativeText: string; members: ReadonlyArray<{ text: string }> }>,
  timestampMs: number,
): Promise<number> {
  if (clusters.length === 0) return 0;
  const notesDir = join(memoryDir(cwd), "notes");
  await mkdir(notesDir, { recursive: true });
  const isoSlug = new Date(timestampMs).toISOString().replace(/[^\dT]/g, "-");
  const file = join(notesDir, `dreamed-${isoSlug}.md`);
  const body = deepPhase(clusters, timestampMs);
  await replaceFileAtomic(file, body);
  return 1;
}

function emptyResult(status: "skipped" | "error"): DreamingResult {
  return {
    status,
    factsBefore: 0,
    factsAfter: 0,
    duplicatesRemoved: 0,
    clustersCreated: 0,
    notesWritten: 0,
    diaryEntryHash: undefined,
  };
}
