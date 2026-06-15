/**
 * `agent.memory` direct API implementation (T2.2, ADR D141 / D142).
 *
 * Builds an `AgentMemory` impl over whichever third-party adapters
 * the `PluginManager` aggregated. Lazy-resolves the adapter list on
 * first access (EC-I: `initialize()` fires exactly once on first
 * write/recall). Multi-adapter fan-out for writes; merge + dedupe by
 * content for recalls.
 *
 * @internal
 */

import { ConfigurationError } from "../../../errors.js";
import type {
  AgentMemory,
  MemoryAdapter,
  MemoryContext,
  MemoryFact,
  MemoryId,
  MemoryTurnMessage,
} from "../../../types/memory-adapter.js";
import type { PluginManager } from "../../plugins/manager.js";

interface ResolvedAdapters {
  adapters: ReadonlyArray<MemoryAdapter>;
  initialized: boolean;
}

/**
 * Build a lazy `AgentMemory` accessor over the plugin-aggregated
 * memory adapters. Returns `null` when no `kind: "memory"` plugin
 * is registered — callers branch on `adapter() === null`.
 *
 * @internal
 */
export function buildAgentMemory(
  pluginManager: PluginManager,
  workspaceCwd: string,
  defaultContext: MemoryContext | undefined,
): AgentMemory {
  let resolved: ResolvedAdapters | undefined;

  async function ensure(): Promise<ResolvedAdapters> {
    if (resolved !== undefined) return resolved;
    const entries = pluginManager.aggregated.memoryProviders;
    const created: MemoryAdapter[] = [];
    for (const entry of entries) {
      const instance = await entry.createProvider(workspaceCwd);
      created.push(instance);
    }
    // EC-I: initialize() each adapter exactly once on first access.
    for (const adapter of created) {
      if (adapter.initialize !== undefined) {
        await adapter.initialize();
      }
    }
    resolved = { adapters: created, initialized: true };
    return resolved;
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 6 optional fields × per-field caller-wins-over-default merge is a flat ladder; extracting helpers fragments the EC-P invariant.
  function mergeContext(partial: Partial<MemoryContext> | undefined): MemoryContext {
    // EC-P: caller's ctx.userId always wins over agent default.
    const merged: MemoryContext = {
      userId: partial?.userId ?? defaultContext?.userId ?? "",
      ...(partial?.agentId !== undefined
        ? { agentId: partial.agentId }
        : defaultContext?.agentId !== undefined
          ? { agentId: defaultContext.agentId }
          : {}),
      ...(partial?.sessionId !== undefined
        ? { sessionId: partial.sessionId }
        : defaultContext?.sessionId !== undefined
          ? { sessionId: defaultContext.sessionId }
          : {}),
      ...(partial?.tenantId !== undefined
        ? { tenantId: partial.tenantId }
        : defaultContext?.tenantId !== undefined
          ? { tenantId: defaultContext.tenantId }
          : {}),
      ...(partial?.tags !== undefined
        ? { tags: partial.tags }
        : defaultContext?.tags !== undefined
          ? { tags: defaultContext.tags }
          : {}),
      ...(partial?.metadata !== undefined
        ? { metadata: partial.metadata }
        : defaultContext?.metadata !== undefined
          ? { metadata: defaultContext.metadata }
          : {}),
    };
    if (merged.userId === "") {
      throw new ConfigurationError(
        "agent.memory requires a userId — either set AgentOptions.memoryContext.userId or pass ctx.userId at call time.",
        { code: "memory_context_missing_user_id" },
      );
    }
    return merged;
  }

  async function requireAdapters(): Promise<ReadonlyArray<MemoryAdapter>> {
    const r = await ensure();
    if (r.adapters.length === 0) {
      throw new ConfigurationError(
        "No memory adapter registered. Pass a memory plugin in AgentOptions.plugins (e.g. supermemoryMemory({...})).",
        { code: "no_memory_adapter" },
      );
    }
    return r.adapters;
  }

  return {
    async write(
      content: string | MemoryTurnMessage[],
      ctx?: Partial<MemoryContext>,
    ): Promise<MemoryId> {
      const adapters = await requireAdapters();
      const merged = mergeContext(ctx);
      // Fan-out: write to all. Return the first id; collect errors per adapter.
      const writes = await Promise.allSettled(adapters.map((a) => a.write(content, merged)));
      const firstFulfilled = writes.find((r) => r.status === "fulfilled");
      if (firstFulfilled === undefined) {
        // All adapters failed — surface the first error.
        const firstReason = writes[0] as PromiseRejectedResult;
        throw firstReason.reason;
      }
      return (firstFulfilled as PromiseFulfilledResult<MemoryId>).value;
    },

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: settled-promise iteration + content dedupe + graceful degrade are 3 inline concerns; helpers would obscure the merge invariant.
    async recall(query: string, ctx?: Partial<MemoryContext>, k?: number): Promise<MemoryFact[]> {
      const adapters = await requireAdapters();
      const merged = mergeContext(ctx);
      // Merge + dedupe by content. Per-adapter failures degrade gracefully:
      // the caller still gets results from healthy adapters.
      const recalls = await Promise.allSettled(adapters.map((a) => a.recall(query, merged, k)));
      const out: MemoryFact[] = [];
      const seen = new Set<string>();
      for (const r of recalls) {
        if (r.status !== "fulfilled") continue;
        for (const fact of r.value) {
          if (seen.has(fact.content)) continue;
          seen.add(fact.content);
          out.push(fact);
        }
      }
      return out;
    },

    async delete(id: MemoryId): Promise<void> {
      const adapters = await requireAdapters();
      // Route by id prefix: the adapter whose id matches the MemoryId prefix.
      const prefix = id.split(":", 1)[0] ?? "";
      const target = adapters.find((a) => a.id === prefix);
      if (target === undefined) {
        throw new ConfigurationError(
          `No adapter found for MemoryId prefix "${prefix}" (registered: ${adapters.map((a) => a.id).join(", ")}).`,
          { code: "no_memory_adapter" },
        );
      }
      await target.delete(id);
    },

    adapter(): MemoryAdapter | null {
      // Synchronous — only useful AFTER `ensure()` resolved at least once.
      // Callers that want adapter introspection should `await agent.memory.write/recall`
      // first to trigger initialization.
      if (resolved === undefined) return null;
      return resolved.adapters[0] ?? null;
    },
  };
}
