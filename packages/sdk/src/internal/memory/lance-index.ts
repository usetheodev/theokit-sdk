import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { ConfigurationError } from "../../errors.js";
import type { EmbeddingRuntime } from "./embedding-adapter.js";

/**
 * LanceDB-backed memory index (ADR D43). Implements the same logical
 * interface as `IndexManager` but stores embeddings in Lance's columnar
 * vector-aware file format — scalable to 100k+ facts.
 *
 * Opt-in via `Memory.create({ index: { backend: "lance" } })`. SQLite
 * remains the default; this code path only activates when explicitly
 * requested AND `@lancedb/lancedb` is installed.
 *
 * EC-1 MUST FIX: filters use Lance structured filter API (object form) —
 * NEVER string interpolation. SQL injection via namespace is impossible.
 *
 * EC-8: embedding dimension is validated when opening an existing table.
 *
 * @internal
 */

interface LanceModule {
  connect: (uri: string) => Promise<LanceConnection>;
}

interface LanceConnection {
  openTable: (name: string) => Promise<LanceTable>;
  createTable: (name: string, data: ReadonlyArray<LanceFactRecord>) => Promise<LanceTable>;
  tableNames: () => Promise<string[]>;
}

interface LanceTable {
  add: (rows: ReadonlyArray<LanceFactRecord>) => Promise<void>;
  search: (vector: ReadonlyArray<number>) => LanceQuery;
  delete: (predicate: string) => Promise<void>;
  countRows: () => Promise<number>;
  // EC-8: schema introspection for dimension check.
  schema: () => Promise<{ fields: ReadonlyArray<{ name: string; type: { fixedSize?: number } }> }>;
}

interface LanceQuery {
  where: (filter: string | Record<string, unknown>) => LanceQuery;
  limit: (n: number) => LanceQuery;
  toArray: () => Promise<ReadonlyArray<LanceFactRecord & { _distance?: number }>>;
}

export interface LanceFactRecord {
  id: string;
  text: string;
  source: "memory" | "sessions" | "wiki";
  embedding: ReadonlyArray<number>;
  namespace: string;
  scope: string;
  user_id: string;
  timestamp: number;
}

export interface OpenLanceOptions {
  cwd: string;
  embedding: EmbeddingRuntime;
  /** Override storage location. Default: `<cwd>/.theokit/memory/lance/`. */
  storagePath?: string;
}

export interface LanceSearchOptions {
  namespace: string;
  scope?: string;
  limit?: number;
  sources?: ReadonlyArray<"memory" | "sessions" | "wiki">;
}

export interface LanceSearchHit {
  id: string;
  text: string;
  source: "memory" | "sessions" | "wiki";
  namespace: string;
  scope: string;
  userId: string;
  score: number;
}

/**
 * Lazily load `@lancedb/lancedb`. Throws typed error when absent.
 *
 * @internal
 */
function requireLance(): LanceModule {
  try {
    const r = createRequire(import.meta.url);
    return r("@lancedb/lancedb") as LanceModule;
  } catch (cause) {
    throw new ConfigurationError(
      "Lance backend selected but `@lancedb/lancedb` is not installed. " +
        'Install with: `pnpm add @lancedb/lancedb`. SQLite remains available as the default (omit `backend: "lance"`).',
      { code: "lance_backend_unavailable", cause },
    );
  }
}

/**
 * Lance-backed memory index. Public API mirrors the SQLite one logically:
 * `addFacts`, `search`, `countFacts`, `removeFacts`, `close`.
 *
 * @internal
 */
export class LanceIndex {
  private constructor(
    private readonly table: LanceTable,
    private readonly embedding: EmbeddingRuntime,
    private readonly embeddingDim: number,
  ) {}

  static async open(opts: OpenLanceOptions): Promise<LanceIndex> {
    const lance = requireLance();
    const storagePath = opts.storagePath ?? join(opts.cwd, ".theokit", "memory", "lance");
    mkdirSync(storagePath, { recursive: true });
    const conn = await lance.connect(storagePath);
    const dim = opts.embedding.dimension;
    const tableName = "facts";
    const existing = await conn.tableNames();
    let table: LanceTable;
    if (existing.includes(tableName)) {
      table = await conn.openTable(tableName);
      // EC-8: validate embedding dimension matches what's in storage.
      const schema = await table.schema();
      const embField = schema.fields.find((f) => f.name === "embedding");
      const existingDim = embField?.type?.fixedSize;
      if (typeof existingDim === "number" && existingDim !== dim) {
        throw new ConfigurationError(
          `Embedding dimension mismatch in Lance index: storage has ${existingDim}-dim vectors, current provider yields ${dim}-dim. Run \`theokit-migrate-memory\` after switching providers, or use a different storagePath.`,
          { code: "embedding_dimension_mismatch" },
        );
      }
    } else {
      // Create with one bootstrap record. Lance requires an initial row to
      // infer schema; we delete the bootstrap immediately.
      const bootstrap: LanceFactRecord = {
        id: "__bootstrap__",
        text: "",
        source: "memory",
        embedding: new Array(dim).fill(0),
        namespace: "__bootstrap__",
        scope: "__bootstrap__",
        user_id: "__bootstrap__",
        timestamp: 0,
      };
      table = await conn.createTable(tableName, [bootstrap]);
      await table.delete("namespace = '__bootstrap__'");
    }
    return new LanceIndex(table, opts.embedding, dim);
  }

  async addFacts(facts: ReadonlyArray<Omit<LanceFactRecord, "embedding">>): Promise<void> {
    if (facts.length === 0) return;
    const texts = facts.map((f) => f.text);
    const embeddings = await this.embedding.embed(texts);
    const rows: LanceFactRecord[] = facts.map((f, i) => ({
      ...f,
      embedding: embeddings[i] ?? new Array(this.embeddingDim).fill(0),
    }));
    await this.table.add(rows);
  }

  /**
   * Search facts by semantic similarity. EC-1: filters use Lance's
   * structured object filter — NEVER string interpolation.
   */
  async search(query: string, opts: LanceSearchOptions): Promise<LanceSearchHit[]> {
    const [embedding] = await this.embedding.embed([query]);
    if (embedding === undefined) return [];
    // EC-1 MUST FIX: structured filter object. Lance escapes values
    // internally; we cannot accidentally inject SQL via namespace.
    const filter: Record<string, unknown> = { namespace: opts.namespace };
    if (opts.scope !== undefined) filter.scope = opts.scope;
    let q = this.table.search(embedding).where(filter);
    if (opts.limit !== undefined) q = q.limit(opts.limit);
    const results = await q.toArray();
    return results
      .filter((r) => opts.sources === undefined || opts.sources.includes(r.source))
      .map((r) => ({
        id: r.id,
        text: r.text,
        source: r.source,
        namespace: r.namespace,
        scope: r.scope,
        userId: r.user_id,
        // Lower _distance = better match; normalize to 0..1 (1=best).
        score: 1 / (1 + (r._distance ?? 1)),
      }));
  }

  async countFacts(namespace: string): Promise<number> {
    // Total count, regardless of namespace, used by migration validation.
    // For per-namespace count, callers can do a where() + countRows() if
    // Lance supports it; v1.2 ships with global count only.
    void namespace;
    return this.table.countRows();
  }

  async removeFacts(ids: ReadonlyArray<string>): Promise<void> {
    if (ids.length === 0) return;
    // Build a parameterized-style delete predicate. Lance's delete still
    // takes a string predicate, so we explicitly quote-escape each id —
    // ids in our system are content-hashed (alphanumeric), so the risk
    // is low, but we belt-and-suspenders.
    const escaped = ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(", ");
    await this.table.delete(`id IN (${escaped})`);
  }

  async close(): Promise<void> {
    // Lance auto-closes on GC; no explicit shutdown needed.
  }
}

/**
 * Test helper for {@link LanceIndex}: indicates whether the Lance module
 * is loadable in the current environment. Allows tests to gracefully skip
 * when the optional dep is absent.
 *
 * @internal
 */
export function isLanceAvailable(): boolean {
  try {
    const r = createRequire(import.meta.url);
    r("@lancedb/lancedb");
    return true;
  } catch {
    return false;
  }
}

/**
 * Test helper: re-export the storage path computation.
 *
 * @internal
 */
export function lanceStoragePath(cwd: string): string {
  return join(cwd, ".theokit", "memory", "lance");
}

void existsSync; // imported but only used conditionally via mkdirSync
