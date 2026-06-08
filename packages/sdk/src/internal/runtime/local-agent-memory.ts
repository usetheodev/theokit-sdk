import type { AgentOptions } from "../../types/agent.js";
import type { MemoryToolSpec } from "../agent-loop/loop-types.js";
import { runActiveMemory } from "../memory/active-memory.js";
import { ActiveMemoryCache } from "../memory/active-memory-cache.js";
import { MEMORY_EMBEDDING_ADAPTERS } from "../memory/adapters/catalog.js";
import { CircuitBreaker } from "../memory/circuit-breaker.js";
import type { EmbeddingRuntime } from "../memory/embedding-adapter.js";
import { IndexManager } from "../memory/index-manager.js";
import type { MemoryIndex } from "../memory/memory-index.js";
import { createMemoryGetTool, createMemorySearchTool } from "../memory/tools.js";
import type { TelemetryHandle } from "../telemetry/tracer.js";

/**
 * Per-agent memory glue. Owns the lazy `IndexManager`, the memory tools
 * cache, and the Active Memory circuit breaker + summary cache. Pulled out
 * of `LocalAgent` to keep that file under the G8 LoC cap.
 *
 * @internal
 */
export class LocalAgentMemory {
  private index: MemoryIndex | undefined;
  private toolsCache: ReadonlyArray<MemoryToolSpec> | undefined;
  private breaker: CircuitBreaker | undefined;
  private cache: ActiveMemoryCache | undefined;

  constructor(
    private readonly options: AgentOptions,
    private readonly workspaceCwd: string,
    private readonly agentId: string,
  ) {}

  /**
   * Sync view of the tool cache (SDK 2.0 Phase 1 Stage 2b — iter 19+).
   * Returns the cached MemoryToolSpec[] when `ensureTools()` has run
   * AND succeeded; undefined otherwise. Lets the
   * `createLocalAgentMemoryProvider` adapter (`buildTools` is sync per
   * the port contract) surface the same tools the legacy path would.
   *
   * Caller MUST have already awaited `ensureTools()` once
   * (adapter does this in `init()`) — otherwise the cache is empty
   * and this returns undefined (matching the "no tools today" semantics).
   */
  getCachedTools(): ReadonlyArray<MemoryToolSpec> | undefined {
    return this.toolsCache;
  }

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
    telemetry?: TelemetryHandle,
  ): Promise<string | undefined> {
    const cfg = this.options.memory?.activeRecall;
    if (cfg?.enabled !== true || this.index === undefined) return undefined;
    if (this.breaker === undefined) this.breaker = new CircuitBreaker();
    if (this.cache === undefined) this.cache = new ActiveMemoryCache();
    const result = await runActiveMemory({
      userText,
      priorMessages,
      index: this.index,
      options: this.buildActiveMemoryOptions(cfg),
      breaker: this.breaker,
      cache: this.cache,
      agentKey: this.agentId,
      cwd: this.workspaceCwd,
      ...(cfg.persistTranscripts === true ? { persistTranscripts: true } : {}),
      runId: `${this.agentId}-${Date.now()}`,
      ...this.buildTelemetryRecallArgs(telemetry),
    });
    return result.summary;
  }

  private buildActiveMemoryOptions(cfg: NonNullable<AgentOptions["memory"]>["activeRecall"]) {
    if (cfg === undefined) return { enabled: true };
    return {
      enabled: true,
      ...(cfg.queryMode !== undefined ? { queryMode: cfg.queryMode } : {}),
      ...(cfg.timeoutMs !== undefined ? { timeoutMs: cfg.timeoutMs } : {}),
      ...(cfg.maxSummaryChars !== undefined ? { maxSummaryChars: cfg.maxSummaryChars } : {}),
    };
  }

  private buildTelemetryRecallArgs(telemetry?: TelemetryHandle) {
    const userId =
      typeof this.options.memoryContext?.userId === "string"
        ? this.options.memoryContext.userId
        : undefined;
    return {
      ...(telemetry !== undefined ? { telemetry } : {}),
      ...(userId !== undefined ? { userId } : {}),
      namespace: "default",
      scope: "session",
    };
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
