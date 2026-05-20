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
  PreToolCallContext,
  PreToolCallDecision,
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
