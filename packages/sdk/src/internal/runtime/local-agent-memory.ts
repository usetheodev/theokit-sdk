import type { AgentOptions } from "../../types/agent.js";
import type { MemoryToolSpec } from "../agent-loop/loop-types.js";
import { runActiveMemory } from "../memory/active-memory.js";
import { ActiveMemoryCache } from "../memory/active-memory-cache.js";
import { MEMORY_EMBEDDING_ADAPTERS } from "../memory/adapters/catalog.js";
import { CircuitBreaker } from "../memory/circuit-breaker.js";
import type { EmbeddingRuntime } from "../memory/embedding-adapter.js";
import { IndexManager } from "../memory/index-manager.js";
import { createMemoryGetTool, createMemorySearchTool } from "../memory/tools.js";

/**
 * Per-agent memory glue. Owns the lazy `IndexManager`, the memory tools
 * cache, and the Active Memory circuit breaker + summary cache. Pulled out
 * of `LocalAgent` to keep that file under the G8 LoC cap.
 *
 * @internal
 */
export class LocalAgentMemory {
  private index: IndexManager | undefined;
  private toolsCache: ReadonlyArray<MemoryToolSpec> | undefined;
  private breaker: CircuitBreaker | undefined;
  private cache: ActiveMemoryCache | undefined;

  constructor(
    private readonly options: AgentOptions,
    private readonly workspaceCwd: string,
    private readonly agentId: string,
  ) {}

  async ensureTools(): Promise<ReadonlyArray<MemoryToolSpec> | undefined> {
    const cfg = this.options.memory?.index;
    if (cfg?.tools === false) return undefined;
    if (this.options.memory?.enabled !== true) return undefined;
    if (this.toolsCache !== undefined) return this.toolsCache;
    try {
      const embedding = await this.maybeCreateEmbeddingRuntime();
      const openOpts: {
        cwd: string;
        embedding?: EmbeddingRuntime;
        backend?: "sqlite-vec" | "lance";
      } = { cwd: this.workspaceCwd };
      if (embedding !== undefined) openOpts.embedding = embedding;
      if (cfg?.backend !== undefined) openOpts.backend = cfg.backend;
      this.index = await IndexManager.open(openOpts);
      await this.index.sync();
      this.toolsCache = [
        createMemorySearchTool({ index: this.index }),
        createMemoryGetTool({ cwd: this.workspaceCwd }),
      ];
      return this.toolsCache;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      process.stderr.write(`[theokit-sdk] memory tools unavailable: ${message}\n`);
      return undefined;
    }
  }

  async runActiveMemoryIfEnabled(
    userText: string,
    priorMessages: ReadonlyArray<{ role: "user" | "assistant"; text: string }>,
  ): Promise<string | undefined> {
    const cfg = this.options.memory?.activeRecall;
    if (cfg?.enabled !== true || this.index === undefined) return undefined;
    if (this.breaker === undefined) this.breaker = new CircuitBreaker();
    if (this.cache === undefined) this.cache = new ActiveMemoryCache();
    const result = await runActiveMemory({
      userText,
      priorMessages,
      index: this.index,
      options: {
        enabled: true,
        ...(cfg.queryMode !== undefined ? { queryMode: cfg.queryMode } : {}),
        ...(cfg.timeoutMs !== undefined ? { timeoutMs: cfg.timeoutMs } : {}),
        ...(cfg.maxSummaryChars !== undefined ? { maxSummaryChars: cfg.maxSummaryChars } : {}),
      },
      breaker: this.breaker,
      cache: this.cache,
      agentKey: this.agentId,
      cwd: this.workspaceCwd,
      ...(cfg.persistTranscripts === true ? { persistTranscripts: true } : {}),
      runId: `${this.agentId}-${Date.now()}`,
    });
    return result.summary;
  }

  /**
   * Trigger a background `IndexManager.sync()` so a freshly written session
   * summary (ADR D20) is recallable via `memory_search({ corpus: "sessions" })`
   * on the next call. Fire-and-forget at the call site; failures degrade to
   * "summary indexed on next regular sync" with a stderr warning.
   *
   * @internal
   */
  async syncIfReady(): Promise<void> {
    if (this.index === undefined) return;
    try {
      await this.index.sync();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      process.stderr.write(`[theokit-sdk] session index sync failed: ${message}\n`);
    }
  }

  private async maybeCreateEmbeddingRuntime(): Promise<EmbeddingRuntime | undefined> {
    const cfg = this.options.memory?.index?.embedding;
    if (cfg === undefined) return undefined;
    const adapter = MEMORY_EMBEDDING_ADAPTERS[cfg.provider];
    if (adapter === undefined) return undefined;
    try {
      return await adapter.create(cfg.model !== undefined ? { model: cfg.model } : {});
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      process.stderr.write(
        `[theokit-sdk] memory embedding ${cfg.provider} unavailable: ${message}\n`,
      );
      return undefined;
    }
  }
}
