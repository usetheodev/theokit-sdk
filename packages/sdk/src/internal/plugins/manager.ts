/**
 * PluginManager — constructs PluginContext per plugin, invokes register()
 * once, aggregates registrations + provider profiles + memory factories
 * (T1.3, ADRs D97-D101).
 *
 * @internal
 */

import type { ProviderProfile } from "../providers/types.js";
import { createPluginContext, type PluginRegistrations } from "./context.js";
import type {
  HookHandler,
  MemoryProviderFactory,
  Plugin,
  PostAssistantReplyContext,
  PreToolCallContext,
  PreToolCallDecision,
  PreUserSendContext,
  PreUserSendResult,
} from "./types.js";

export interface ProviderEntry {
  pluginName: string;
  profile: ProviderProfile;
}

export interface MemoryEntry {
  pluginName: string;
  createProvider: MemoryProviderFactory;
}

export interface AggregatedPlugins {
  tools: PluginRegistrations["tools"];
  commands: PluginRegistrations["commands"];
  hooks: PluginRegistrations["hooks"];
  injected: PluginRegistrations["injected"];
  providerProfiles: ProviderEntry[];
  memoryProviders: MemoryEntry[];
}

export class PluginManager {
  #aggregated: AggregatedPlugins = {
    tools: [],
    commands: [],
    hooks: new Map(),
    injected: [],
    providerProfiles: [],
    memoryProviders: [],
  };
  #initialized = false;

  async initialize(plugins: ReadonlyArray<Plugin>): Promise<void> {
    if (this.#initialized) {
      throw new Error("PluginManager.initialize called twice — register only once per process");
    }
    this.#initialized = true;
    // EC-4: surface duplicate plugin names so operators notice. Two plugins
    // with the same name are usually a mistake (npm install with override).
    const seen = new Set<string>();
    for (const plugin of plugins) {
      if (seen.has(plugin.name)) {
        process.stderr.write(
          `[theokit-sdk] duplicate plugin name "${plugin.name}" — both will register independently\n`,
        );
      }
      seen.add(plugin.name);
      await this.#dispatchPlugin(plugin);
    }
  }

  get aggregated(): Readonly<AggregatedPlugins> {
    return this.#aggregated;
  }

  /**
   * Run all `pre_tool_call` hooks; first decision with `block: true` wins.
   * D101: veto pattern — return `{ block: true, message }` makes the loop
   * surface a tool_result with `isError: false, content: message` so the
   * LLM can self-correct.
   */
  async runPreToolCallHooks(ctx: PreToolCallContext): Promise<PreToolCallDecision | undefined> {
    const handlers = this.#aggregated.hooks.get("pre_tool_call") ?? [];
    for (const h of handlers) {
      const decision = (await (h as (c: PreToolCallContext) => unknown)(ctx)) as
        | PreToolCallDecision
        | undefined;
      if (decision !== undefined && (decision as { block?: boolean }).block === true) {
        return decision as PreToolCallDecision;
      }
    }
    return undefined;
  }

  /** Aggregated handlers for a given hook (read-only view). @internal */
  hooksFor(name: Parameters<AggregatedPlugins["hooks"]["get"]>[0]): ReadonlyArray<HookHandler> {
    return this.#aggregated.hooks.get(name) ?? [];
  }

  /**
   * Run all `pre_user_send` hooks; concatenate non-empty `recalledContext`
   * outputs with `\n\n` and cap total length at `maxRecallContextBytes`
   * (EC-A). Per-handler failures are caught + logged to stderr (EC-8) so a
   * single broken adapter never blocks the LLM call (graceful degrade).
   *
   * Returns the assembled context (or undefined if empty after cap).
   *
   * @internal
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: per-handler try/catch + EC-A cap + EC-8 isolation are 3 concerns that share state (parts buffer); splitting fragments the single-pass aggregation.
  async runPreUserSendHooks(
    ctx: PreUserSendContext,
    maxRecallContextBytes: number,
  ): Promise<string | undefined> {
    const handlers = this.#aggregated.hooks.get("pre_user_send") ?? [];
    if (handlers.length === 0) return undefined;
    const parts: string[] = [];
    for (const h of handlers) {
      try {
        const result = (await (h as (c: PreUserSendContext) => unknown)(ctx)) as
          | PreUserSendResult
          | undefined;
        if (result?.recalledContext && result.recalledContext.length > 0) {
          parts.push(result.recalledContext);
        }
      } catch (err) {
        process.stderr.write(
          `[theokit-sdk] pre_user_send hook failed: ${
            err instanceof Error ? err.message : String(err)
          }\n`,
        );
      }
    }
    if (parts.length === 0) return undefined;
    let combined = parts.join("\n\n");
    // EC-A: cap to prevent context-window blowout.
    if (combined.length > maxRecallContextBytes) {
      combined = `${combined.slice(0, maxRecallContextBytes)}\n…[truncated]`;
    }
    return combined;
  }

  /**
   * Run all `post_assistant_reply` hooks. Fire-and-forget: errors are
   * surfaced to stderr (EC-O) so a slow/broken sync never blocks the
   * caller's `wait()`. Returns a Promise that callers may optionally
   * await for tests; production code typically `void`s it.
   *
   * @internal
   */
  async runPostAssistantReplyHooks(ctx: PostAssistantReplyContext): Promise<void> {
    const handlers = this.#aggregated.hooks.get("post_assistant_reply") ?? [];
    for (const h of handlers) {
      try {
        await (h as (c: PostAssistantReplyContext) => unknown)(ctx);
      } catch (err) {
        process.stderr.write(
          `[theokit-sdk] post_assistant_reply hook failed: ${
            err instanceof Error ? err.message : String(err)
          }\n`,
        );
      }
    }
  }

  async #dispatchPlugin(plugin: Plugin): Promise<void> {
    if (plugin.kind === "general") {
      const { ctx, registrations } = createPluginContext();
      await plugin.register(ctx);
      this.#merge(registrations);
    } else if (plugin.kind === "model-provider") {
      this.#aggregated.providerProfiles.push({
        pluginName: plugin.name,
        profile: plugin.profile,
      });
    } else if (plugin.kind === "memory") {
      this.#aggregated.memoryProviders.push({
        pluginName: plugin.name,
        createProvider: plugin.createProvider,
      });
    }
  }

  #merge(r: PluginRegistrations): void {
    this.#aggregated.tools.push(...r.tools);
    this.#aggregated.commands.push(...r.commands);
    for (const [hook, handlers] of r.hooks.entries()) {
      const existing = this.#aggregated.hooks.get(hook) ?? [];
      existing.push(...handlers);
      this.#aggregated.hooks.set(hook, existing);
    }
    this.#aggregated.injected.push(...r.injected);
  }
}
