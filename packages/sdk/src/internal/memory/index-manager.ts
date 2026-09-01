import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { sanitizeFts5Query } from "../persistence/fts5-sanitize.js";
import type { EmbeddingRuntime } from "./embedding-adapter.js";
import { LruEmbeddingCache } from "./embedding-cache.js";
import { escapeLikePattern } from "./escape-like-pattern.js";
import { defaultIndexPath, type MemoryDb, openMemoryDb } from "./index-db.js";
import { assertValidBackend, openLanceIndex } from "./index-manager-dispatch.js";
import {
  blendScores,
  collectMarkdownFiles,
  resolveWeights,
  sha256,
  truncateSnippet,
} from "./index-manager-helpers.js";
import type { SyncResult } from "./memory-index.js";
import { type MemoryIndex, parseSearchOptions } from "./memory-index.js";
import { loadSqliteVecExtension } from "./sqlite-vec-loader.js";
import { chunkMarkdown } from "./storage/chunk-markdown.js";
import { type MemoryRoot, projectMemoryDir, resolveMemoryRoot } from "./storage/memory-root.js";

// T4.1 — query-vector LRU cache (DR4 finding #1). Keyed by
// sha256(query); caches the embedding vector so repeated search
// queries skip the HTTP round-trip (p99 1.5-3s → ~0ms on hit).
// Process-wide singleton with bounded capacity (default 2000 queries).
const queryVectorCache = new LruEmbeddingCache(2000);

import {
  createVectorIndex,
  dropVectorIndex,
  embedMissingChunks,
  identityMatches,
  readEmbeddingIdentity,
  vectorSearch,
  writeEmbeddingIdentity,
} from "./vec-index.js";

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

// T2.1 / ADR D433 — these types now live in `index-manager-contract.ts`
// to break the 3-cycle memory cluster. Re-exported here for back-compat
// with downstream importers that historically pulled from this file.
export type {
  IndexStatus,
  MemoryBackend,
  MemorySearchHit,
  OpenIndexOptions,
  SearchOptions,
} from "./index-manager-contract.js";

import type {
  IndexStatus,
  MemorySearchHit,
  OpenIndexOptions,
  SearchOptions,
} from "./index-manager-contract.js";

export class IndexManager implements MemoryIndex {
  private lastSyncMs: number | undefined;
  private vectorReady = false;

  private constructor(
    private readonly memoryRoot: MemoryRoot,
    private readonly db: MemoryDb,
    private readonly embedding: EmbeddingRuntime | undefined,
  ) {}

  /**
   * Open a memory index. Dispatches to SQLite (default) or Lance (opt-in
   * via `backend: "lance"`). See `openLanceInternal` for Lance-specific
   * preconditions + typed errors.
   */
  static async open(opts: OpenIndexOptions & { backend: "lance" }): Promise<MemoryIndex>;
  static async open(
    opts: Omit<OpenIndexOptions, "backend"> | (OpenIndexOptions & { backend?: "sqlite-vec" }),
  ): Promise<IndexManager>;
  static async open(opts: OpenIndexOptions): Promise<MemoryIndex> {
    const backend = opts.backend ?? "sqlite-vec";
    assertValidBackend(backend);
    if (backend === "lance") return await openLanceIndex(opts);
    return await IndexManager.openSqliteInternal(opts);
  }

  /** Internal SQLite-path open. Renamed from previous public `open`. */
  private static async openSqliteInternal(opts: OpenIndexOptions): Promise<IndexManager> {
    const memoryRoot = opts.memoryRoot ?? resolveMemoryRoot(opts.cwd);
    // What gets INDEXED and where the DATABASE lives are two decisions, and they diverge on
    // purpose. The corpus is the configured root; the database stays in the project store, because
    // `memory.directory` may name the directory the Claude Code CLI manages and that CLI has no
    // index format (`docs/memory-decisions.md` § 1). Collapsing them writes a binary the partner
    // does not understand into a directory it owns.
    const filePath = opts.filePath ?? defaultIndexPath(projectMemoryDir(opts.cwd));
    const db = await openMemoryDb({ filePath });
    const manager = new IndexManager(memoryRoot, db, opts.embedding);
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
  // Declares `Promise<SyncResult>` rather than repeating the shape inline. The inline version was a
  // structural copy of the interface it implements, so widening `SyncResult` with `supported` left
  // this method silently no longer assignable to `MemoryIndex` — the compiler caught it, which is
  // the argument for naming the type instead of restating it.
  async sync(): Promise<SyncResult> {
    const files = await collectMarkdownFiles(this.memoryRoot);
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
    // `supported: true` — this implementer genuinely walks the corpus, so its counts are a
    // measurement rather than a placeholder. See SyncResult.supported.
    return {
      filesScanned: files.length,
      filesUpdated,
      chunksWritten,
      chunksEmbedded,
      supported: true,
    };
  }

  async search(query: string, options: SearchOptions = {}): Promise<MemorySearchHit[]> {
    if (query.trim().length === 0) return [];
    const { maxResults, minScore } = parseSearchOptions(options);
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
      // Counted with SELECT COUNT(*) just above — these are measurements, not placeholders.
      countsExact: true,
    };
    if (this.lastSyncMs !== undefined) status.lastSyncMs = this.lastSyncMs;
    return status;
  }

  // ───── search internals ──────────────────────────────────────────────

  private ftsSearch(query: string, limit: number): Array<MemorySearchHit & { chunkId: number }> {
    // EC-3: short-circuit when sanitizer reduces input to empty string.
    // Calling `MATCH ''` would error inside FTS5 on some SQLite versions.
    const sanitized = sanitizeFts5Query(query);
    if (sanitized.length === 0) return [];
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
      rows = stmt.all(sanitized, limit);
    } catch {
      // T4.8 — CJK fallback: FTS5's default tokenizer chokes on CJK
      // characters (no word boundaries). Instead of returning empty,
      // fall back to a LIKE search which handles CJK correctly (slower
      // but correct). ADR D64 documents the trigram-routing deferral.
      return this.likeSearchFallback(query, limit);
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

  /**
   * T4.8 — LIKE-based fallback for CJK and other scripts that FTS5's
   * default tokenizer cannot segment. Slower than FTS5 (full table scan)
   * but correct for any Unicode input. Returns the same shape as
   * `ftsSearch` so callers are unaware of the fallback.
   */
  private likeSearchFallback(
    query: string,
    limit: number,
  ): Array<MemorySearchHit & { chunkId: number }> {
    const pattern = escapeLikePattern(query);
    const stmt = this.db.prepare(
      `SELECT chunks.id as id, files.rel_path as rel_path, files.source as source,
              chunks.start_line as start_line, chunks.end_line as end_line,
              chunks.text as text
       FROM chunks
       JOIN files ON chunks.file_id = files.id
       WHERE chunks.text LIKE ? ESCAPE '\\'
       LIMIT ?`,
    );
    const rows = stmt.all(pattern, limit) as Array<Record<string, unknown>>;
    return rows.map((row) => {
      const path = String(row.rel_path ?? "");
      const startLine = Number(row.start_line ?? 0);
      const endLine = Number(row.end_line ?? 0);
      return {
        path,
        startLine,
        endLine,
        score: 0.5, // LIKE has no relevance score — use a neutral midpoint
        textScore: 0.5,
        snippet: truncateSnippet(String(row.text ?? "")),
        source: String(row.source) as "memory" | "sessions" | "wiki",
        citation: `${path}:${startLine}-${endLine}`,
        chunkId: Number(row.id),
      } as MemorySearchHit & { chunkId: number };
    });
  }

  private async vectorSearchById(
    query: string,
    limit: number,
  ): Promise<Map<number, { vectorScore: number; snippet?: string }>> {
    if (!this.vectorReady || this.embedding === undefined) return new Map();
    // T4.1 — query-vector LRU cache. The embed call is the p99 hottest
    // path (1.5-3s per hit). Cache by sha256(query) so repeated queries
    // skip the HTTP round-trip entirely. The embedding cache (T4.4
    // globalEmbeddingCache) catches text-level dedup; this catches the
    // query-level search-result dedup on top.
    const cacheKey = createHash("sha256").update(query).digest("hex");
    const cached = queryVectorCache.get(cacheKey);
    const queryVec = cached ?? (await this.embedding.embed([query]))[0];
    if (queryVec === undefined) return new Map();
    if (cached === undefined) queryVectorCache.set(cacheKey, queryVec);
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

// Replaced by `sanitizeFts5Query` from `internal/persistence/fts5-sanitize.ts`
// (T5.2, ADR D64). The new sanitizer is the 6-step port of Hermes'
// `_sanitize_fts5_query` and handles hyphens/dots/underscores correctly
// without quoting every token.
