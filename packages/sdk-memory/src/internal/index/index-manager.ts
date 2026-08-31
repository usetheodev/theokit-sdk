import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

import { sanitizeFts5Query } from "@theokit/sdk/persistence";
import type { EmbeddingRuntime } from "../embedding/embedding-adapter.js";
import { chunkMarkdown } from "../store/chunk-markdown.js";
import {
  collectMarkdownFiles,
  defaultIndexPath,
  type MemoryRoot,
  projectMemoryDir,
  resolveMemoryRoot,
} from "../store/markdown-store.js";
import { type MemoryDb, openMemoryDb } from "./index-db.js";
import { assertValidBackend, openLanceIndex } from "./index-manager-dispatch.js";
import { type MemoryIndex, parseSearchOptions } from "./memory-index.js";
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
 * Iter 72 (Stage 3 source-move #29): hybrid copy from sdk-core's
 * `internal/memory/index-manager.ts`. sdk-core retains its copy for
 * v1.x back-compat; sdk-memory ships the canonical orchestrator
 * composing every prior Stage 3 move (sqlite-vec stack iter 47/49/50/53/55-57/62/65-67,
 * lance stack iter 68-70, storage iter 56). The biggest move of the
 * stage at 446 LOC — closes the index/ cluster.
 *
 * @internal
 */

// T2.1 / ADR D433 — these types live in `index-manager-contract.ts`
// (iter 47). The canonical sdk-core copy re-exports them here for
// back-compat. In sdk-memory the public barrel already does
// `export * from "./internal/index-manager-contract.js"` so a second
// re-export from this file confuses rollup-dts and triggers
// "is not exported" emit errors. Mirrors iter 50 memory-index NOTE.
//
// **Iter 72 rollup-plugin-dts workaround** (mirrors iter 48/53/55/66/67/69):
// the canonical sdk-core copy imports `MemorySearchHit` (et al.) from
// sibling. rollup-dts treeshakes the inner type declarations because
// no PUBLIC type reaches them transitively yet within this file's
// bundling pass. Fix: declare structural mirrors of the index-manager-contract
// types inline so the index-manager.ts file's emit is self-contained.
// When a future move surfaces these through a different
// publicly-reachable path, these mirrors MUST be deleted + the
// canonical type imports restored.

interface MemorySearchHit {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly score: number;
  readonly textScore: number;
  readonly vectorScore?: number;
  readonly snippet: string;
  readonly source: "memory" | "sessions" | "wiki";
  readonly citation: string;
}

interface IndexStatus {
  backend: "fts-only" | "hybrid";
  filesIndexed: number;
  chunksIndexed: number;
  lastSyncMs?: number;
}

interface SearchOptions {
  maxResults?: number;
  minScore?: number;
  vectorWeight?: number;
  textWeight?: number;
  sources?: ReadonlyArray<"memory" | "sessions" | "wiki">;
}

interface OpenIndexOptions {
  cwd: string;
  /**
   * The memory root to index and to place the database under. Defaults to `<cwd>/.theokit/memory`.
   *
   * Optional here and required below: this is the entry point a caller reaches with a workspace in
   * hand, while every path helper under it demands a resolved root (#463).
   */
  memoryRoot?: MemoryRoot;
  filePath?: string;
  embedding?: EmbeddingRuntime;
  backend?: "sqlite-vec" | "lance";
}

/**
 * The default memory index: SQLite for storage, FTS5 for text matching, and
 * sqlite-vec for vectors when an embedding runtime is supplied.
 *
 * Open it with the static `open`, which is also the dispatch point for
 * `backend: "lance"` — that overload returns a `LanceMemoryAdapter`, not an
 * `IndexManager`, so hold the result as {@link MemoryIndex} unless you need this
 * class specifically.
 *
 * Storage needs `better-sqlite3` unless the running Node exposes `node:sqlite`,
 * and vectors additionally need `sqlite-vec`. Both are optional peer
 * dependencies of this package. Without an embedding runtime the index opens
 * text-only and reports `backend: "fts-only"`; no vector table is created and
 * search degrades to BM25 rather than failing.
 *
 * `sync()` crawls the markdown corpus — `MEMORY.md`, `notes/`, `wiki/` and
 * `sessions/` — skipping files whose content hash has not moved, and re-chunking
 * the rest. Nothing is indexed until it runs.
 *
 * If the embedding provider, model or dimension differs from what the database
 * recorded, opening drops the whole vector table so the next `sync()` re-embeds
 * from scratch. Switching embedding models is therefore safe but not cheap.
 *
 * `search()` runs both halves and blends them per chunk, so a chunk found only
 * by vector still appears with a text score of 0 and the other way round.
 * `close()` releases the database handle; it is synchronous here, unlike the
 * Lance adapter's, so a caller holding the {@link MemoryIndex} type must await
 * it either way.
 */
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
   * via `backend: "lance"`). See `openLanceIndex` for Lance-specific
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
    // Corpus and database diverge on purpose — see `defaultIndexPath` for why (#463).
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
  async sync(): Promise<{
    filesScanned: number;
    filesUpdated: number;
    chunksWritten: number;
    chunksEmbedded: number;
  }> {
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
    return { filesScanned: files.length, filesUpdated, chunksWritten, chunksEmbedded };
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

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function truncateSnippet(text: string): string {
  const max = 500;
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

// Replaced by `sanitizeFts5Query` from `@theokit/sdk/persistence`
// (T5.2, ADR D64). The new sanitizer is the 6-step port of Hermes'
// `_sanitize_fts5_query` and handles hyphens/dots/underscores correctly
// without quoting every token.
