import { MEMORY_EMBEDDING_ADAPTERS } from "./internal/memory/adapters/catalog.js";
import { runDreamingSweep as runDreamingSweepInternal } from "./internal/memory/dreaming/run.js";

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
   * `"openai"`, `"mistral"`, `"openrouter"`, `"voyage"`, `"deepinfra"`.
   */
  embedding: {
    provider: "openai" | "mistral" | "openrouter" | "voyage" | "deepinfra";
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

export const Memory = {
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
