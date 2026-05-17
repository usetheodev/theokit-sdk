import type {
  AgentDefinition,
  AgentOptions,
  CloudOptions,
  CustomTool,
  LocalOptions,
  MemorySettings,
  ModelSelection,
  SDKAgent,
  SkillsSettings,
  SystemPromptResolver,
} from "./types/agent.js";
import type { ContextSettings } from "./types/context.js";
import type { McpServerConfig } from "./types/mcp.js";
import type { PluginsSettings, ProviderRoutingSettings } from "./types/providers.js";

/**
 * Terminal-method callbacks injected by `Agent.builder()` so that
 * `agent-builder.ts` does NOT need a static import of `Agent` — keeps the
 * dependency graph acyclic (G6).
 *
 * @internal
 */
interface AgentBuilderDeps {
  create: (options: AgentOptions) => Promise<SDKAgent>;
  getOrCreate: (agentId: string, options: AgentOptions) => Promise<SDKAgent>;
}

/**
 * Fluent builder for {@link AgentOptions}. Chainable setters mutate internal
 * state and return `this`. Three terminals:
 *
 * - `.build()` — synchronous snapshot (shallow clone) of accumulated options.
 * - `.create()` — calls the injected `create` (Agent.create).
 * - `.getOrCreate(agentId)` — calls the injected `getOrCreate` (Agent.getOrCreate).
 *
 * Validation runs inside the terminals via `validateAgentOptions`. See ADR D25.
 *
 * @public
 */
export class AgentBuilder {
  private opts: Partial<AgentOptions> = {};
  private readonly deps: AgentBuilderDeps | undefined;

  constructor(deps?: AgentBuilderDeps) {
    this.deps = deps;
  }

  model(m: ModelSelection): this {
    this.opts.model = m;
    return this;
  }
  apiKey(k: string): this {
    this.opts.apiKey = k;
    return this;
  }
  name(n: string): this {
    this.opts.name = n;
    return this;
  }
  systemPrompt(p: string | SystemPromptResolver): this {
    this.opts.systemPrompt = p;
    return this;
  }
  local(l: LocalOptions): this {
    this.opts.local = l;
    return this;
  }
  cloud(c: CloudOptions): this {
    this.opts.cloud = c;
    return this;
  }
  memory(m: MemorySettings): this {
    this.opts.memory = m;
    return this;
  }
  tools(t: CustomTool[]): this {
    this.opts.tools = t;
    return this;
  }
  mcpServers(s: Record<string, McpServerConfig>): this {
    this.opts.mcpServers = s;
    return this;
  }
  agents(a: Record<string, AgentDefinition>): this {
    this.opts.agents = a;
    return this;
  }
  context(c: ContextSettings): this {
    this.opts.context = c;
    return this;
  }
  providers(p: ProviderRoutingSettings): this {
    this.opts.providers = p;
    return this;
  }
  plugins(p: PluginsSettings): this {
    this.opts.plugins = p;
    return this;
  }
  skills(s: SkillsSettings): this {
    this.opts.skills = s;
    return this;
  }
  agentId(id: string): this {
    this.opts.agentId = id;
    return this;
  }

  /**
   * Synchronous snapshot of the accumulated options. Returns a SHALLOW CLONE
   * so external mutation of the result doesn't pollute the builder state (EC-2).
   */
  build(): AgentOptions {
    return { ...this.opts } as AgentOptions;
  }

  /**
   * Validate + create a fresh agent. Delegates to `Agent.create` via the
   * injected `deps.create`. Throws if the builder was instantiated without
   * deps (i.e., direct `new AgentBuilder()` instead of `Agent.builder()`).
   */
  create(): Promise<SDKAgent> {
    if (this.deps === undefined) {
      return Promise.reject(
        new Error(
          "AgentBuilder.create() requires Agent.builder() entry — direct construction has no terminals.",
        ),
      );
    }
    return this.deps.create(this.build());
  }

  /**
   * Resume an existing agent or create one if the ID is unknown. Delegates to
   * `Agent.getOrCreate` via the injected `deps.getOrCreate` (ADR D22).
   */
  getOrCreate(agentId: string): Promise<SDKAgent> {
    if (this.deps === undefined) {
      return Promise.reject(
        new Error(
          "AgentBuilder.getOrCreate() requires Agent.builder() entry — direct construction has no terminals.",
        ),
      );
    }
    return this.deps.getOrCreate(agentId, this.build());
  }
}
