import { MEMORY_EMBEDDING_ADAPTERS } from "./internal/memory/adapters/catalog.js";
import { runDreamingSweep as runDreamingSweepInternal } from "./internal/memory/dreaming/run.js";

/**
 * Public handle to an open memory index. Mirrors the internal `MemoryIndex`
 * contract structurally; defined here (NOT re-exported from internal/) so
 * the public DTS surface does not pull the internal/runtime cycle that
 * trips rollup-plugin-dts.
 *
 * @public
 */
export interface MemoryIndexHandle {
  sync(): Promise<{
    filesScanned: number;
    filesUpdated: number;
    chunksWritten: number;
    chunksEmbedded: number;
  }>;
  search(
    query: string,
    options?: {
      maxResults?: number;
      minScore?: number;
      sources?: ReadonlyArray<"memory" | "sessions" | "wiki">;
    },
  ): Promise<
    ReadonlyArray<{
      path: string;
      startLine: number;
      endLine: number;
      score: number;
      textScore: number;
      vectorScore?: number;
      snippet: string;
      source: "memory" | "sessions" | "wiki";
      citation: string;
    }>
  >;
  status(): {
    backend: "fts-only" | "hybrid";
    filesIndexed: number;
    chunksIndexed: number;
    lastSyncMs?: number;
  };
  close(): Promise<void> | void;
}

/**
 * Public `Memory` namespace.
 *
 * Exposes operations users can run outside of `agent.send()` — most notably
 * the dreaming sweep (consolidation of facts via dedup + clustering).
 *
 * @public
 */

export interface DreamingSweepOptions {
  /** Workspace cwd holding `.theokit/memory/`. */
  cwd: string;
  /**
   * Embedding provider for semantic dedup + clustering. Required — dreaming
   * relies on real embeddings to score cosine similarity. Supported providers:
   * `"openai"`, `"mistral"`, `"openrouter"`, `"voyage"`, `"deepinfra"`,
   * `"ollama"` (local, ADR D183).
   */
  embedding: {
    provider: "openai" | "mistral" | "openrouter" | "voyage" | "deepinfra" | "ollama";
    model?: string;
  };
  /** Cosine-similarity threshold for the dedup phase. Default `0.95`. */
  dedupThreshold?: number;
  /** Cosine-similarity threshold for the clustering phase. Default `0.75`. */
  clusterThreshold?: number;
}

export interface DreamingSweepResult {
  status: "ok" | "skipped" | "error";
  factsBefore: number;
  factsAfter: number;
  duplicatesRemoved: number;
  clustersCreated: number;
  notesWritten: number;
}

/**
 * Options for `Memory.openIndex`. Mirrors the internal `OpenIndexOptions`
 * but using only public types from the SDK surface.
 *
 * @public
 */
export interface OpenMemoryIndexOptions {
  /** Workspace cwd holding `.theokit/memory/`. */
  cwd: string;
  /** Override storage file path (SQLite) OR storage directory (Lance). */
  filePath?: string;
  /**
   * Embedding runtime — REQUIRED for `backend: "lance"`, optional for
   * `"sqlite-vec"` (when omitted, SQLite runs FTS-only without vector
   * recall).
   */
  embedding?: {
    provider: "openai" | "mistral" | "openrouter" | "voyage" | "deepinfra" | "ollama";
    model?: string;
  };
  /** Default `"sqlite-vec"`. Set to `"lance"` to opt into LanceDB (peer dep). */
  backend?: "sqlite-vec" | "lance";
}

export const Memory = {
  /**
   * Open a memory index. Dispatches to SQLite-vec (default, zero deps) or
   * LanceDB (opt-in via `backend: "lance"`, requires `@lancedb/lancedb`
   * peer dep + an embedding runtime).
   *
   * Returns a `MemoryIndex` with `sync()`, `search(query, opts?)`,
   * `status()`, and `close()`. Use this when you want a direct index
   * handle outside of `Agent.create({ memory: ... })`.
   *
   * @throws ConfigurationError({code:"invalid_memory_backend"}) for typos
   *   like `"lancedb"`.
   * @throws ConfigurationError({code:"lance_requires_embedding"}) when
   *   `backend: "lance"` is requested without `embedding`.
   * @throws ConfigurationError({code:"lance_backend_unavailable"}) when
   *   `backend: "lance"` is requested but the peer dep is absent.
   *
   * @public
   */
  async openIndex(opts: OpenMemoryIndexOptions): Promise<MemoryIndexHandle> {
    // Lazy import to avoid pulling internal/runtime types into the public
    // DTS surface (rollup-plugin-dts trips on a pre-existing cycle in
    // types/agent.ts ↔ fork-agent.ts when reached transitively).
    const { IndexManager } = await import("./internal/memory/index-manager.js");
    let embedding: import("./internal/memory/embedding-adapter.js").EmbeddingRuntime | undefined;
    if (opts.embedding !== undefined) {
      const adapter = MEMORY_EMBEDDING_ADAPTERS[opts.embedding.provider];
      if (adapter === undefined) {
        throw new Error(
          `Unknown embedding provider "${opts.embedding.provider}". Supported: ${Object.keys(
            MEMORY_EMBEDDING_ADAPTERS,
          ).join(", ")}.`,
        );
      }
      embedding = await adapter.create(
        opts.embedding.model !== undefined ? { model: opts.embedding.model } : {},
      );
    }
    // Cast: structural-compat (internal MemoryIndex matches MemoryIndexHandle).
    return (await IndexManager.open({
      cwd: opts.cwd,
      ...(opts.filePath !== undefined ? { filePath: opts.filePath } : {}),
      ...(embedding !== undefined ? { embedding } : {}),
      ...(opts.backend !== undefined ? { backend: opts.backend } : {}),
    })) as MemoryIndexHandle;
  },

  /**
   * Run a dreaming sweep: dedup near-duplicate facts, cluster thematically
   * related ones, and write a consolidated note + diary entry.
   *
   * @public
   */
  async runDreamingSweep(opts: DreamingSweepOptions): Promise<DreamingSweepResult> {
    const adapter = MEMORY_EMBEDDING_ADAPTERS[opts.embedding.provider];
    if (adapter === undefined) {
      // Should be unreachable thanks to the typed `provider` union, but guard
      // explicitly for runtime-source callers (JS without types).
      throw new Error(
        `Unknown embedding provider "${opts.embedding.provider}". Supported: ${Object.keys(
          MEMORY_EMBEDDING_ADAPTERS,
        ).join(", ")}.`,
      );
    }
    const runtime = await adapter.create(
      opts.embedding.model !== undefined ? { model: opts.embedding.model } : {},
    );
    const result = await runDreamingSweepInternal({
      cwd: opts.cwd,
      embedding: runtime,
      ...(opts.dedupThreshold !== undefined ? { dedupThreshold: opts.dedupThreshold } : {}),
      ...(opts.clusterThreshold !== undefined ? { clusterThreshold: opts.clusterThreshold } : {}),
    });
    return {
      status: result.status,
      factsBefore: result.factsBefore,
      factsAfter: result.factsAfter,
      duplicatesRemoved: result.duplicatesRemoved,
      clustersCreated: result.clustersCreated,
      notesWritten: result.notesWritten,
    };
  },
};
