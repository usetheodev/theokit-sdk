import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import type { MemorySearchHit, SearchOptions } from "./index-manager-contract.js";
import { memoryDir, memoryMdPath, notesDir } from "./storage/markdown-store.js";
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

/** @internal */
export async function collectMarkdownFiles(cwd: string): Promise<DiscoveredFile[]> {
  const root = memoryDir(cwd);
  const results: DiscoveredFile[] = [];
  // MEMORY.md
  try {
    await stat(memoryMdPath(cwd));
    results.push({
      absolutePath: memoryMdPath(cwd),
      relPath: relative(root, memoryMdPath(cwd)),
      source: "memory",
    });
  } catch {
    // skip
  }
  // notes/*.md
  try {
    const entries = await readdir(notesDir(cwd));
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const abs = join(notesDir(cwd), entry);
      results.push({ absolutePath: abs, relPath: relative(root, abs), source: "memory" });
    }
  } catch {
    // notes dir doesn't exist yet — that's fine
  }
  // wiki/*.md (Phase 10 — read-only supplements)
  const wikiFiles = await discoverWikiFiles(cwd);
  for (const wiki of wikiFiles) {
    results.push({
      absolutePath: wiki.absolutePath,
      relPath: wiki.relPath,
      source: "wiki",
    });
  }
  // sessions/*.md (ADR D20 — per-run summaries for corpus="sessions" recall)
  const sessionFiles = await discoverSessionFiles(cwd);
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
