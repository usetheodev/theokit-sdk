import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import type { MemorySearchHit, SearchOptions } from "./index-manager-contract.js";
import { memoryMdPath, notesDir } from "./storage/markdown-store.js";
import type { MemoryRoot } from "./storage/memory-root.js";
import { discoverSessionFiles } from "./storage/session-loader.js";
import { discoverWikiFiles } from "./storage/wiki-loader.js";

// ───── hybrid scoring helpers ─────────────────────────────────────────

/** @internal */
export interface HybridWeights {
  vectorWeight: number;
  textWeight: number;
  total: number;
}

/** @internal */
export function resolveWeights(options: SearchOptions): HybridWeights {
  const vectorWeight = options.vectorWeight ?? 0.6;
  const textWeight = options.textWeight ?? 0.4;
  const total = vectorWeight + textWeight || 1;
  return { vectorWeight, textWeight, total };
}

/** @internal */
export function blendScores(
  hit: MemorySearchHit & { chunkId: number },
  vectorScore: number,
  weights: HybridWeights,
): MemorySearchHit {
  const score =
    (vectorScore * weights.vectorWeight + hit.textScore * weights.textWeight) / weights.total;
  return {
    path: hit.path,
    startLine: hit.startLine,
    endLine: hit.endLine,
    score,
    textScore: hit.textScore,
    snippet: hit.snippet,
    source: hit.source,
    citation: hit.citation,
    ...(vectorScore > 0 ? { vectorScore } : {}),
  };
}

// ───── file discovery ─────────────────────────────────────────────────

/** @internal */
export interface DiscoveredFile {
  absolutePath: string;
  relPath: string;
  source: "memory" | "wiki" | "sessions";
}

/**
 * Every `*.md` in `dir` as a discovered memory file, minus `skip`. A directory that does not exist
 * yet contributes nothing — the store is created lazily, and its absence is not an error.
 */
async function markdownFilesIn(
  dir: string,
  root: string,
  skip: readonly string[] = [],
): Promise<DiscoveredFile[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.endsWith(".md") && !skip.includes(entry))
    .map((entry) => ({
      absolutePath: join(dir, entry),
      relPath: relative(root, join(dir, entry)),
      source: "memory" as const,
    }));
}

/** @internal */
export async function collectMarkdownFiles(root: MemoryRoot): Promise<DiscoveredFile[]> {
  const results: DiscoveredFile[] = [];
  // MEMORY.md
  try {
    await stat(memoryMdPath(root));
    results.push({
      absolutePath: memoryMdPath(root),
      relPath: relative(root, memoryMdPath(root)),
      source: "memory",
    });
  } catch {
    // skip
  }
  // <memoryDir>/*.md — one file per memory, the converged layout. MEMORY.md is the index and is
  // discovered above; picking it up twice would index every memory's link alongside its text.
  results.push(...(await markdownFilesIn(root, root, ["MEMORY.md"])));
  results.push(...(await markdownFilesIn(notesDir(root), root)));
  // wiki/*.md (Phase 10 — read-only supplements)
  const wikiFiles = await discoverWikiFiles(root);
  for (const wiki of wikiFiles) {
    results.push({
      absolutePath: wiki.absolutePath,
      relPath: wiki.relPath,
      source: "wiki",
    });
  }
  // sessions/*.md (ADR D20 — per-run summaries for corpus="sessions" recall)
  const sessionFiles = await discoverSessionFiles(root);
  for (const session of sessionFiles) {
    results.push({
      absolutePath: session.absolutePath,
      relPath: session.relPath,
      source: "sessions",
    });
  }
  return results;
}

// ───── misc helpers ───────────────────────────────────────────────────

/** @internal */
export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** @internal */
export function truncateSnippet(text: string): string {
  const max = 500;
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
