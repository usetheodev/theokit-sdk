import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import { chunkMarkdown } from "./chunk-markdown.js";
import type { EmbeddingRuntime } from "./embedding-adapter.js";
import { defaultIndexPath, type MemoryDb, openMemoryDb } from "./index-db.js";
import { memoryDir, memoryMdPath, notesDir } from "./markdown-store.js";
import { discoverSessionFiles } from "./session-loader.js";
import { loadSqliteVecExtension } from "./sqlite-vec-loader.js";
import {
  createVectorIndex,
  dropVectorIndex,
  embedMissingChunks,
  identityMatches,
  readEmbeddingIdentity,
  vectorSearch,
  writeEmbeddingIdentity,
} from "./vec-index.js";
import { discoverWikiFiles } from "./wiki-loader.js";

/**
 * Memory index manager (ADR D2). FTS5-only at Phase 3; vector index lands in
 * Phase 5.
 *
 * Lifecycle:
 *   const idx = await IndexManager.open({ cwd });
 *   await idx.sync();
 *   const hits = await idx.search("query");
 *   idx.close();
 *
 * @internal
 */

export interface MemorySearchHit {
  /** Path relative to the memory root. */
  path: string;
  startLine: number;
  endLine: number;
  /** Combined score (hybrid when vector backend active, else just textScore). */
  score: number;
  /** FTS5 BM25 score normalized to 0..1 (higher = better). */
  textScore: number;
  /** sqlite-vec distance normalized to 0..1 (higher = better). Omitted when vector backend disabled. */
  vectorScore?: number;
  snippet: string;
  source: "memory" | "sessions" | "wiki";
  /** path:startLine-endLine for citations. */
  citation: string;
}

export interface IndexStatus {
  backend: "fts-only" | "hybrid";
  filesIndexed: number;
  chunksIndexed: number;
  lastSyncMs?: number;
}

export interface SearchOptions {
  maxResults?: number;
  minScore?: number;
  sources?: ReadonlyArray<"memory" | "sessions" | "wiki">;
  /** 0..1 — vector vs text weight in hybrid scoring (D4). Default 0.6. */
  vectorWeight?: number;
  /** 0..1 — text weight in hybrid scoring. Default 0.4. */
  textWeight?: number;
}

/** Vector backend selector. Only `"sqlite-vec"` ships today. */
export type MemoryBackend = "sqlite-vec";

export interface OpenIndexOptions {
  cwd: string;
  filePath?: string;
  /** When provided, vector index is enabled in hybrid mode. */
  embedding?: EmbeddingRuntime;
  /** Vector backend. Default and only value today: `"sqlite-vec"`. */
  backend?: MemoryBackend;
}

export class IndexManager {
  private lastSyncMs: number | undefined;
  private vectorReady = false;

  private constructor(
    private readonly cwd: string,
    private readonly db: MemoryDb,
    private readonly embedding: EmbeddingRuntime | undefined,
  ) {}

  static async open(opts: OpenIndexOptions): Promise<IndexManager> {
    const filePath = opts.filePath ?? defaultIndexPath(opts.cwd);
    const db = await openMemoryDb({ filePath });
    const manager = new IndexManager(opts.cwd, db, opts.embedding);
    if (opts.embedding !== undefined) await manager.initVectorBackend(opts.embedding);
    return manager;
  }

  private async initVectorBackend(runtime: EmbeddingRuntime): Promise<void> {
    await loadSqliteVecExtension(this.db);
    const currentIdentity = {
      providerId: runtime.id,
      model: runtime.model,
      dimension: runtime.dimension,
    };
    const persisted = readEmbeddingIdentity(this.db);
    if (persisted !== undefined && !identityMatches(persisted, currentIdentity)) {
      // EC-1: dimension/model/provider changed — drop the vector index and
      // force a full re-embed on next sync.
      dropVectorIndex(this.db);
    }
    createVectorIndex(this.db, runtime.dimension);
    writeEmbeddingIdentity(this.db, currentIdentity);
    this.vectorReady = true;
  }

  /** Walk the memory corpus + (re)index changed files. */
  async sync(): Promise<{
    filesScanned: number;
    filesUpdated: number;
    chunksWritten: number;
    chunksEmbedded: number;
  }> {
    const files = await collectMarkdownFiles(this.cwd);
    let filesUpdated = 0;
    let chunksWritten = 0;
    const existingByPath = this.loadFilesIndex();
    for (const entry of files) {
      const raw = await readFile(entry.absolutePath, "utf8");
      const hash = sha256(raw);
      const existing = existingByPath.get(entry.absolutePath);
      if (existing !== undefined && existing.hash === hash) continue;
      const stats = await stat(entry.absolutePath);
      const fileId = this.upsertFile(
        entry.absolutePath,
        entry.relPath,
        hash,
        stats.mtimeMs,
        entry.source,
      );
      this.deleteChunksForFile(fileId);
      const chunks = chunkMarkdown(raw);
      for (const chunk of chunks) {
        this.insertChunk(fileId, chunk.startLine, chunk.endLine, chunk.text, chunk.hash);
      }
      filesUpdated += 1;
      chunksWritten += chunks.length;
    }
    let chunksEmbedded = 0;
    if (this.vectorReady && this.embedding !== undefined) {
      chunksEmbedded = await embedMissingChunks({ db: this.db, runtime: this.embedding });
    }
    this.lastSyncMs = Date.now();
    return { filesScanned: files.length, filesUpdated, chunksWritten, chunksEmbedded };
  }

  async search(query: string, options: SearchOptions = {}): Promise<MemorySearchHit[]> {
    if (query.trim().length === 0) return [];
    const maxResults = Math.max(1, options.maxResults ?? 10);
    const minScore = options.minScore ?? 0;
    const textHits = this.ftsSearch(query, maxResults * 2);
    const vectorHitsById = await this.vectorSearchById(query, maxResults * 2);
    const combined = this.combineHybridScores(textHits, vectorHitsById, options);
    return combined
      .filter((h) => h.score >= minScore)
      .filter((h) => options.sources === undefined || options.sources.includes(h.source))
      .slice(0, maxResults);
  }

  status(): IndexStatus {
    const files = this.db.prepare("SELECT COUNT(*) as n FROM files").get() ?? { n: 0 };
    const chunks = this.db.prepare("SELECT COUNT(*) as n FROM chunks").get() ?? { n: 0 };
    const status: IndexStatus = {
      backend: this.vectorReady ? "hybrid" : "fts-only",
      filesIndexed: Number(files.n ?? 0),
      chunksIndexed: Number(chunks.n ?? 0),
    };
    if (this.lastSyncMs !== undefined) status.lastSyncMs = this.lastSyncMs;
    return status;
  }

  // ───── search internals ──────────────────────────────────────────────

  private ftsSearch(query: string, limit: number): Array<MemorySearchHit & { chunkId: number }> {
    const stmt = this.db.prepare(
      `SELECT chunks.id as id, files.rel_path as rel_path, files.source as source,
              chunks.start_line as start_line, chunks.end_line as end_line,
              chunks.text as text, bm25(chunks_fts) as bm25_score
       FROM chunks_fts
       JOIN chunks ON chunks_fts.rowid = chunks.id
       JOIN files  ON chunks.file_id = files.id
       WHERE chunks_fts MATCH ?
       ORDER BY bm25_score
       LIMIT ?`,
    );
    let rows: Array<Record<string, unknown>> = [];
    try {
      rows = stmt.all(sanitizeFtsQuery(query), limit);
    } catch {
      return [];
    }
    return rows.map((row) => {
      const bm25 = Number(row.bm25_score ?? 0);
      const textScore = bm25 < 0 ? 1 / (1 + Math.abs(bm25)) : 1 / (1 + bm25);
      const startLine = Number(row.start_line ?? 0);
      const endLine = Number(row.end_line ?? 0);
      const path = String(row.rel_path);
      return {
        path,
        startLine,
        endLine,
        score: textScore,
        textScore,
        snippet: truncateSnippet(String(row.text ?? "")),
        source: String(row.source) as "memory" | "sessions" | "wiki",
        citation: `${path}:${startLine}-${endLine}`,
        // sneak the chunk id through for the hybrid join below
        // (cast away later)
        chunkId: Number(row.id),
      } as MemorySearchHit & { chunkId: number };
    });
  }

  private async vectorSearchById(
    query: string,
    limit: number,
  ): Promise<Map<number, { vectorScore: number; snippet?: string }>> {
    if (!this.vectorReady || this.embedding === undefined) return new Map();
    const [queryVec] = await this.embedding.embed([query]);
    if (queryVec === undefined) return new Map();
    const rows = vectorSearch(this.db, queryVec, limit);
    // sqlite-vec distance: lower = closer. Normalize to 0..1 with higher = better.
    const out = new Map<number, { vectorScore: number }>();
    for (const row of rows) {
      const score = 1 / (1 + Math.max(0, row.distance));
      out.set(row.chunk_id, { vectorScore: score });
    }
    return out;
  }

  private combineHybridScores(
    textHits: Array<MemorySearchHit & { chunkId: number }>,
    vectorHitsById: Map<number, { vectorScore: number }>,
    options: SearchOptions,
  ): MemorySearchHit[] {
    const weights = resolveWeights(options);
    const merged = this.mergeHits(textHits, vectorHitsById);
    const combined = [...merged.values()].map((hit) =>
      blendScores(hit, vectorHitsById.get(hit.chunkId)?.vectorScore ?? 0, weights),
    );
    return combined.sort((a, b) => b.score - a.score);
  }

  private mergeHits(
    textHits: Array<MemorySearchHit & { chunkId: number }>,
    vectorHitsById: Map<number, { vectorScore: number }>,
  ): Map<number, MemorySearchHit & { chunkId: number }> {
    const merged = new Map<number, MemorySearchHit & { chunkId: number }>();
    for (const hit of textHits) merged.set(hit.chunkId, hit);
    const missingIds = [...vectorHitsById.keys()].filter((id) => !merged.has(id));
    if (missingIds.length > 0) {
      for (const hit of this.fetchChunksByIds(missingIds)) {
        merged.set(hit.chunkId, { ...hit, score: 0, textScore: 0 });
      }
    }
    return merged;
  }

  private fetchChunksByIds(
    ids: ReadonlyArray<number>,
  ): Array<MemorySearchHit & { chunkId: number }> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT chunks.id as id, files.rel_path as rel_path, files.source as source,
                chunks.start_line as start_line, chunks.end_line as end_line,
                chunks.text as text
         FROM chunks JOIN files ON chunks.file_id = files.id
         WHERE chunks.id IN (${placeholders})`,
      )
      .all(...ids);
    return rows.map((row) => {
      const startLine = Number(row.start_line ?? 0);
      const endLine = Number(row.end_line ?? 0);
      const path = String(row.rel_path);
      return {
        chunkId: Number(row.id),
        path,
        startLine,
        endLine,
        score: 0,
        textScore: 0,
        snippet: truncateSnippet(String(row.text ?? "")),
        source: String(row.source) as "memory" | "sessions" | "wiki",
        citation: `${path}:${startLine}-${endLine}`,
      };
    });
  }

  // ───── persistence helpers ─────────────────────────────────────────

  private loadFilesIndex(): Map<string, { id: number; hash: string }> {
    const rows = this.db.prepare("SELECT id, path, hash FROM files").all() as Array<{
      id: number;
      path: string;
      hash: string;
    }>;
    return new Map(rows.map((row) => [row.path, { id: row.id, hash: row.hash }]));
  }

  private upsertFile(
    absPath: string,
    relPath: string,
    hash: string,
    mtimeMs: number,
    source: "memory" | "wiki" | "sessions" = "memory",
  ): number {
    const stmt = this.db.prepare(
      `INSERT INTO files (path, rel_path, mtime, hash, source) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET hash = excluded.hash, mtime = excluded.mtime, source = excluded.source
       RETURNING id`,
    );
    const row = stmt.get(absPath, relPath, Math.floor(mtimeMs), hash, source) as { id: number };
    return row.id;
  }

  private deleteChunksForFile(fileId: number): void {
    this.db.prepare("DELETE FROM chunks WHERE file_id = ?").run(fileId);
  }

  private insertChunk(
    fileId: number,
    startLine: number,
    endLine: number,
    text: string,
    hash: string,
  ): void {
    this.db
      .prepare(
        "INSERT INTO chunks (file_id, start_line, end_line, text, hash) VALUES (?, ?, ?, ?, ?)",
      )
      .run(fileId, startLine, endLine, text, hash);
  }

  close(): void {
    this.db.close();
  }
}

// ───── module-level helpers (hybrid scoring) ─────────────────────────────

interface HybridWeights {
  vectorWeight: number;
  textWeight: number;
  total: number;
}

function resolveWeights(options: SearchOptions): HybridWeights {
  const vectorWeight = options.vectorWeight ?? 0.6;
  const textWeight = options.textWeight ?? 0.4;
  const total = vectorWeight + textWeight || 1;
  return { vectorWeight, textWeight, total };
}

function blendScores(
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

interface DiscoveredFile {
  absolutePath: string;
  relPath: string;
  source: "memory" | "wiki" | "sessions";
}

async function collectMarkdownFiles(cwd: string): Promise<DiscoveredFile[]> {
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

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function truncateSnippet(text: string): string {
  const max = 500;
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function sanitizeFtsQuery(query: string): string {
  // FTS5 special chars: quote each token, drop empty terms. Keeps phrase semantics
  // simple and avoids "unterminated string" errors.
  return query
    .split(/\s+/)
    .map((t) => t.replace(/["']/g, ""))
    .filter((t) => t.length > 0)
    .map((t) => `"${t}"`)
    .join(" ");
}
