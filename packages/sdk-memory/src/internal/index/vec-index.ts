import type { EmbeddingRuntime } from "../embedding/embedding-adapter.js";

/**
 * **Iter 67 rollup-plugin-dts workaround** (mirrors iter 48/53/55/66 pattern).
 * The canonical sdk-core copy imports `MemoryDb` from sibling
 * `./index-db.js`. In sdk-memory the same interface lives in sibling
 * `./index-db.js` (moved iter 65) but rollup-dts treeshakes it
 * out of the bundled .d.ts emit because no PUBLIC type reaches it
 * transitively yet. Same pattern as iter 66 with sqlite-vec-loader.
 *
 * Fix: inline a structural mirror of the minimal MemoryDb shape this
 * file actually needs (exec + prepare for SQL emits, plus pragma /
 * close / loadExtension on the canonical surface to stay shape-compatible
 * with consumers passing the real MemoryDb). When a future move
 * surfaces MemoryDb through a different publicly-reachable path,
 * this mirror MUST be deleted + the canonical import restored.
 *
 * @internal
 */
interface MemoryDb {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...args: unknown[]): Record<string, unknown> | undefined;
    all(...args: unknown[]): Array<Record<string, unknown>>;
  };
  pragma(statement: string, options?: { simple?: boolean }): unknown;
  close(): void;
  loadExtension(path: string): void;
}

// Vector index helpers (ADR D2 + D4 of memory-system-peer-project-parity).
//
// Embeddings live in `embeddings(chunk_id, vec)` — a `vec0` virtual table
// provided by the sqlite-vec extension. Embedding identity (providerId +
// model + dimension) lives in the `meta` table; mismatches force a full
// re-embed sweep (EC-1).
//
// Iter 67 (Stage 3 source-move #24): hybrid copy from sdk-core's
// `internal/memory/vec-index.ts`. sdk-core retains its copy for v1.x
// sqlite-vec back-compat; sdk-memory ships the canonical copy that
// future `index-manager.ts` move will compose with as a sibling.
// Dependency chain (both sibling, both moved):
// - `EmbeddingRuntime` from `./embedding-adapter.js` (moved iter 45)
// - `MemoryDb` from `./index-db.js` (moved iter 65)

/**
 * `meta` table key holding the id of the embedding provider that produced the
 * vectors currently on disk (for example `openai`, `ollama`).
 */
export const META_KEY_PROVIDER_ID = "embedding.providerId";
/** `meta` table key holding the embedding model id the vectors were produced with. */
export const META_KEY_MODEL = "embedding.model";
/** `meta` table key holding the vector width the `embeddings` vec0 table was created with. */
export const META_KEY_DIMENSION = "embedding.dimension";

/**
 * The three facts that decide whether the vectors already stored are still
 * usable: who produced them, with which model, at which width. A change in any
 * of the three invalidates every vector in the index, because embeddings from
 * different models are not comparable and a different width will not even fit
 * the vec0 table.
 */
export interface EmbeddingIdentity {
  providerId: string;
  model: string;
  dimension: number;
}

/**
 * Read the embedding identity recorded in the `meta` table.
 *
 * Returns `undefined` when the index has never been embedded, and also when the
 * record is incomplete or unusable: any of the three keys missing, or a stored
 * dimension that is not a finite number greater than zero. Callers treat that as
 * "no identity" and write a fresh one rather than trying to repair it.
 */
export function readEmbeddingIdentity(db: MemoryDb): EmbeddingIdentity | undefined {
  const get = (key: string): string | undefined => {
    const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
    return row !== undefined ? String(row.value) : undefined;
  };
  const providerId = get(META_KEY_PROVIDER_ID);
  const model = get(META_KEY_MODEL);
  const dimRaw = get(META_KEY_DIMENSION);
  if (providerId === undefined || model === undefined || dimRaw === undefined) return undefined;
  const dimension = Number(dimRaw);
  if (!Number.isFinite(dimension) || dimension <= 0) return undefined;
  return { providerId, model, dimension };
}

/**
 * Record the embedding identity in the `meta` table, upserting each of the three
 * keys. Call this after {@link createVectorIndex}, so that a later open can tell
 * whether the vectors on disk match the runtime it has been handed.
 */
export function writeEmbeddingIdentity(db: MemoryDb, identity: EmbeddingIdentity): void {
  const stmt = db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  stmt.run(META_KEY_PROVIDER_ID, identity.providerId);
  stmt.run(META_KEY_MODEL, identity.model);
  stmt.run(META_KEY_DIMENSION, String(identity.dimension));
}

/**
 * Compare two embedding identities field by field. All three fields must be
 * equal; there is no tolerance on dimension, because a mismatch there is a hard
 * failure at the vec0 table rather than a quality regression.
 */
export function identityMatches(a: EmbeddingIdentity, b: EmbeddingIdentity): boolean {
  return a.providerId === b.providerId && a.model === b.model && a.dimension === b.dimension;
}

/**
 * Drop the `embeddings` table, discarding every stored vector. `IndexManager`
 * calls this when {@link identityMatches} reports that the persisted identity
 * differs from the embedding runtime it was opened with; the next `sync()` then
 * re-embeds the whole corpus. The `chunks` and `files` tables are untouched, so
 * the text index survives the drop.
 */
export function dropVectorIndex(db: MemoryDb): void {
  db.exec("DROP TABLE IF EXISTS embeddings");
}

/**
 * Create the `embeddings` vec0 virtual table at the given vector width, if it
 * does not exist already. Requires the sqlite-vec extension to be loaded into
 * `db` first (see `loadSqliteVecExtension`) — without it SQLite has no `vec0`
 * module and the statement fails.
 *
 * `IF NOT EXISTS` means this will NOT widen an existing table: to change the
 * dimension, call {@link dropVectorIndex} first.
 */
export function createVectorIndex(db: MemoryDb, dimension: number): void {
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS embeddings USING vec0(
    chunk_id INTEGER PRIMARY KEY,
    vec FLOAT[${dimension}]
  )`);
}

/** Pack a Float32Array into a Buffer suitable for sqlite-vec BLOB binding. */
export function packVector(vec: ReadonlyArray<number>): Buffer {
  const f32 = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) f32[i] = vec[i] ?? 0;
  return Buffer.from(f32.buffer);
}

/**
 * Store the vector for one chunk, replacing any vector already held for it.
 *
 * Implemented as DELETE followed by INSERT because vec0 virtual tables do not
 * support `ON CONFLICT`. The chunk id is bound as a BigInt: vec0 v0.1.9 rejects
 * a JavaScript number for its primary-key column.
 */
export function upsertEmbedding(db: MemoryDb, chunkId: number, vec: ReadonlyArray<number>): void {
  // sqlite-vec vec0 virtual tables don't support UPSERT — emulate via
  // DELETE-then-INSERT. vec0 REJECTS JS Number for chunk_id columns; it
  // requires BigInt binding. Verified via repro against vec0 v0.1.9.
  const id = BigInt(chunkId);
  db.prepare("DELETE FROM embeddings WHERE chunk_id = ?").run(id);
  db.prepare("INSERT INTO embeddings (chunk_id, vec) VALUES (?, ?)").run(id, packVector(vec));
}

/**
 * One row of a vec0 KNN result: the chunk id and its raw distance from the query
 * vector. Distance is the sqlite-vec convention — lower is closer — and is NOT a
 * similarity score. `IndexManager` maps it to `1 / (1 + distance)` before
 * blending it with the text score.
 */
export interface VectorHitRow {
  chunk_id: number;
  distance: number;
}

/**
 * Run a k-nearest-neighbour query against the `embeddings` table and return the
 * matches ordered by ascending distance (closest first).
 *
 * `query` must have the same width the table was created with. Both the query
 * vector and `k` are bound in the form vec0 expects — the vector as a packed
 * Float32 blob, `k` as a BigInt.
 */
export function vectorSearch(
  db: MemoryDb,
  query: ReadonlyArray<number>,
  k: number,
): VectorHitRow[] {
  // sqlite-vec returns distance (lower = closer). Use KNN syntax. k needs
  // a BigInt-typed binding too.
  const rows = db
    .prepare(
      `SELECT chunk_id, distance FROM embeddings
       WHERE vec MATCH ? AND k = ?
       ORDER BY distance`,
    )
    .all(packVector(query), BigInt(k));
  return rows.map((row) => ({ chunk_id: Number(row.chunk_id), distance: Number(row.distance) }));
}

/** Inputs for {@link embedMissingChunks}: the open database and the embedding runtime to call. */
export interface EmbedAllArgs {
  db: MemoryDb;
  runtime: EmbeddingRuntime;
}

/** Embed every chunk that doesn't yet have a vector. */
export async function embedMissingChunks(args: EmbedAllArgs): Promise<number> {
  const rows = args.db
    .prepare(
      `SELECT chunks.id as id, chunks.text as text
       FROM chunks
       LEFT JOIN embeddings ON embeddings.chunk_id = chunks.id
       WHERE embeddings.chunk_id IS NULL`,
    )
    .all();
  if (rows.length === 0) return 0;
  const normalized = rows.map((row) => ({ id: Number(row.id), text: String(row.text ?? "") }));
  const vectors = await args.runtime.embed(normalized.map((r) => r.text));
  for (let i = 0; i < normalized.length; i++) {
    const row = normalized[i];
    const vector = vectors[i];
    if (row === undefined || vector === undefined) continue;
    upsertEmbedding(args.db, row.id, vector);
  }
  return normalized.length;
}
