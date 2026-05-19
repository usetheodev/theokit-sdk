import type { ContextSettings, SDKContextManager } from "./context.js";
import type { McpServerConfig } from "./mcp.js";
import type { PluginsSettings, ProviderRoutingSettings, SDKProvidersManager } from "./providers.js";
import type { Run, SDKUserMessage, SendOptions } from "./run.js";

/**
 * One slot in a {@link ModelSelection.params} array.
 *
 * @public
 */
export interface ModelParameterValue {
  id: string;
  value: string;
}

/**
 * Identifies a model plus optional per-model parameters (e.g. reasoning effort).
 *
 * Use `Theokit.models.list()` to discover valid ids and parameter definitions.
 *
 * @public
 */
export interface ModelSelection {
  id: string;
  params?: ModelParameterValue[];
}

/**
 * Which on-disk settings layers a local agent loads.
 *
 * @public
 */
export type SettingSource = "project" | "user" | "team" | "mdm" | "plugins" | "all";

/**
 * Local agent configuration.
 *
 * @public
 */
export interface LocalOptions {
  cwd?: string | string[];
  settingSources?: SettingSource[];
  sandboxOptions?: { enabled: boolean };
}

/**
 * Repo to clone into a cloud agent's VM.
 *
 * @public
 */
export interface CloudRepo {
  url: string;
  startingRef?: string;
  prUrl?: string;
}

/**
 * Cloud execution environment.
 *
 * @public
 */
export interface CloudEnv {
  type: "cloud" | "pool" | "machine";
  name?: string;
}

/**
 * Cloud agent configuration.
 *
 * @public
 */
export interface CloudOptions {
  env?: CloudEnv;
  repos?: CloudRepo[];
  workOnCurrentBranch?: boolean;
  autoCreatePR?: boolean;
  skipReviewerRequest?: boolean;
  /**
   * Short-lived credentials scoped to the agent. Encrypted at rest, deleted
   * with the agent. Names must not start with `THEOKIT_`.
   */
  envVars?: Record<string, string>;
}

/**
 * Subagent definition. The parent agent spawns these via its Agent tool.
 *
 * @public
 */
export interface AgentDefinition {
  description: string;
  prompt: string;
  model?: ModelSelection | "inherit";
  mcpServers?: Array<string | Record<string, McpServerConfig>>;
}

/**
 * Public skill metadata exposed to the system-prompt resolver. Mirrors the
 * shape returned by `agent.skills.list()` — name + description only, never
 * full skill bodies.
 *
 * @public
 */
export interface SystemPromptSkillRef {
  name: string;
  description: string;
}

/**
 * Public skill listing handle exposed as `agent.skills`. Populated when
 * `settingSources` includes `"project"` so the SDK discovers
 * `.theokit/skills/<name>/SKILL.md` files OR when `skills.enabled` is set
 * explicitly on the agent options.
 *
 * @public
 */
export interface SDKAgentSkills {
  list(): Promise<ReadonlyArray<SystemPromptSkillRef>>;
}

/**
 * Public plugin metadata returned by `agent.plugins.list()`. Mirrors the
 * `.theokit/plugins/<name>/MANIFEST.json` allow-listed shape; never exposes
 * raw plugin bodies, credentials, or internal hooks.
 *
 * @public
 */
export interface SDKPluginMetadata {
  name: string;
  description?: string;
}

/**
 * Public plugin listing handle exposed as `agent.plugins`. Populated when
 * `settingSources` includes `"plugins"` OR when `plugins.enabled` is set
 * on the agent options.
 *
 * @public
 */
export interface SDKAgentPlugins {
  list(): Promise<ReadonlyArray<SDKPluginMetadata>>;
}

/**
 * Public view of a recalled memory fact exposed to the system-prompt resolver.
 *
 * @public
 */
export interface SystemPromptMemoryFact {
  text: string;
}

/**
 * Context passed to a {@link SystemPromptResolver}. Field order is a
 * compatibility contract: new fields are appended, never reordered.
 *
 * @public
 */
export interface SystemPromptContext {
  agentId: string;
  cwd: string | undefined;
  model: ModelSelection | undefined;
  skills: ReadonlyArray<SystemPromptSkillRef>;
  userMessage: string;
  /** Recalled durable facts when memory is enabled. Appended in v1.1. */
  memory: ReadonlyArray<SystemPromptMemoryFact>;
}

/**
 * Resolver function that produces the system prompt dynamically. Receives
 * the {@link SystemPromptContext} and returns a string (or a Promise of one).
 *
 * The SDK does NOT impose a timeout on the resolver — wrap your own
 * `Promise.race` if you call into slow resources. Errors propagate to the
 * caller of `agent.send()`.
 *
 * @public
 */
export type SystemPromptResolver = (ctx: SystemPromptContext) => string | Promise<string>;

/**
 * Skills configuration accepted by `Agent.create()` via
 * {@link AgentOptions.skills}.
 *
 * Skills are discovered from `.theokit/skills/<name>/SKILL.md` when
 * `local.settingSources` includes `"project"`.
 *
 * @public
 */
export interface SkillsSettings {
  /**
   * Names of skills the parent agent may invoke. When omitted, every
   * discovered skill is enabled.
   */
  enabled?: string[];
  /**
   * Whether the SDK auto-injects the loaded skill list (name + description) as a
   * `<skills>` block in the LLM system prompt. Default `true`.
   *
   * Set to `false` when supplying a custom `systemPrompt` resolver that formats
   * skills itself.
   */
  autoInject?: boolean;
}

/**
 * Memory configuration accepted by `Agent.create()` via {@link AgentOptions.memory}.
 *
 * Persists durable facts under `.theokit/memory/<namespace>/<scope>-<userId>.json`.
 *
 * @public
 */
export interface MemorySettings {
  enabled: boolean;
  namespace?: string;
  userId?: string;
  scope?: "agent" | "user" | "team";
  storePath?: string;
  /**
   * Whether the SDK auto-injects recalled facts as a `<memory>` block in the
   * LLM system prompt. Default `true`.
   */
  autoInject?: boolean;
  /**
   * Index + tools configuration (memory-system-openclaw-parity).
   *
   * When `tools !== false`, the SDK registers `memory_search` and
   * `memory_get` with the LLM. Backed by SQLite + FTS5 (and sqlite-vec
   * when an embedding provider is configured).
   */
  index?: {
    /** Whether to register `memory_search` + `memory_get` tools. Default `true`. */
    tools?: boolean;
    /**
     * Vector index backend (ADR D43). Default `"sqlite-vec"`. Set to
     * `"lance"` to use `@lancedb/lancedb` (optional peer dep) for scale.
     */
    backend?: "sqlite-vec" | "lance";
    /** Embedding provider config. When omitted, the index runs in FTS-only mode. */
    embedding?: {
      provider: "openai" | "mistral" | "openrouter" | "voyage" | "deepinfra";
      model?: string;
    };
  };
  /**
   * Active Memory blocking recall (Phase 7). When `enabled: true`, runs
   * before each `send()` and prepends an `<active-memory>` block.
   */
  activeRecall?: {
    enabled?: boolean;
    queryMode?: "message" | "recent" | "full";
    timeoutMs?: number;
    maxSummaryChars?: number;
    persistTranscripts?: boolean;
  };
}

/**
 * Inline custom tool — registered with the LLM under the given name + schema
 * and dispatched locally to {@link CustomTool.handler} when the model emits a
 * `tool_use` for it.
 *
 * Local runtime only (SDK v1.0). Cloud agents reject `tools` (handlers cannot
 * cross the wire — use MCP servers or subagents for cloud tool surfaces).
 *
 * Handlers MUST be re-passed on `Agent.resume()` because closures cannot be
 * persisted. The tool catalog (name + description + schema) is NOT serialized.
 *
 * @public
 */
export interface CustomTool {
  /**
   * Tool name surfaced to the LLM. Must match `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`
   * and must not collide with `shell`, `memory_search`, `memory_get`, or any
   * `mcp_*` prefix (reserved for the SDK's built-in tools).
   */
  name: string;
  /** Description surfaced to the LLM. Required — drives tool-selection accuracy. */
  description: string;
  /** JSON Schema (Draft-7 subset) describing the `input` argument. Must be `type: "object"`. */
  inputSchema: Record<string, unknown>;
  /**
   * Local handler invoked when the model emits `tool_use` for this tool.
   * Returns a string (becomes the `tool_result.content` surfaced back to the
   * model). Throws → SDK converts to `tool_result` with `isError: true` and
   * the error `message` as content.
   */
  handler: (input: Record<string, unknown>) => string | Promise<string>;
}

/**
 * Telemetry configuration for an agent. When `enabled: true`, the SDK emits
 * OpenTelemetry spans for `agent.send`, `llm.call`, `tool.call`, and
 * `memory.search`. See ADR D34.
 *
 * Privacy: content (prompts, responses, tool args) is OMITTED by default —
 * only timing/counts/IDs are recorded. Opt in via `includeContent: true`
 * to add prompt/response/args events to the spans (consumer's
 * responsibility to sanitize PII).
 *
 * `@opentelemetry/api` is an OPTIONAL peer dependency. Without it
 * installed, telemetry is a no-op even when `enabled: true`.
 *
 * @public
 */
export interface TelemetrySettings {
  /** Master switch. Default `false`. */
  enabled: boolean;
  /** Whether to include prompts/responses/tool args as span events. Default `false`. */
  includeContent?: boolean;
  /** Exporter selection. Default `"console"`. Custom exporters are passed-through. */
  exporter?: "console" | "otlp" | unknown;
  /** Service name on emitted spans. Default `"theokit-sdk"`. */
  serviceName?: string;
  /**
   * Auto-detect and register OTel exporters for installed observability
   * libs (Langfuse, Sentry, PostHog) via `createRequire` feature-detect.
   * Default `true`. See ADR D42.
   */
  autoDetect?: boolean;
  /**
   * Per-adapter opt-out. Lowercase names: `"langfuse" | "sentry" | "posthog"`.
   * Default `[]`.
   */
  disable?: string[];
}

/**
 * Top-level options accepted by `Agent.create()`.
 *
 * Pass either `local` or `cloud` to pick a runtime.
 *
 * @public
 */
export interface AgentOptions {
  model?: ModelSelection;
  /** Falls back to `THEOKIT_API_KEY`. */
  apiKey?: string;
  name?: string;
  /**
   * System prompt for the agent. Either a plain string or a resolver
   * function that receives the {@link SystemPromptContext} and returns the
   * prompt dynamically. Override per-call via {@link SendOptions.systemPrompt}.
   *
   * Subagents do NOT inherit this — they use {@link AgentDefinition.prompt}.
   */
  systemPrompt?: string | SystemPromptResolver;
  local?: LocalOptions;
  cloud?: CloudOptions;
  mcpServers?: Record<string, McpServerConfig>;
  agents?: Record<string, AgentDefinition>;
  agentId?: string;
  /** Context manager configuration. See `agent.context`. */
  context?: ContextSettings;
  /** Provider routing configuration. See `agent.providers`. */
  providers?: ProviderRoutingSettings;
  /** Plugins to enable. Plugin sources must also be active via `local.settingSources`. */
  plugins?: PluginsSettings;
  /** Skills configuration. See `agent.skills`. */
  skills?: SkillsSettings;
  /** Memory configuration. Persists durable facts; auto-recalled on send. */
  memory?: MemorySettings;
  /**
   * Inline custom tools. Local runtime only — cloud agents reject any non-empty
   * `tools` array. Handlers are not persisted; pass them again on resume.
   * See {@link CustomTool}.
   */
  tools?: CustomTool[];
  /**
   * Telemetry (OpenTelemetry) configuration. Default disabled. See
   * {@link TelemetrySettings} and ADR D34.
   */
  telemetry?: TelemetrySettings;
  /**
   * Arbitrary metadata bag for caller-supplied provenance. Currently used by
   * the fork primitive (ADR D114) to tag `metadata.forkOrigin` and
   * `metadata.parentAgentId` so memory writes downstream can be attributed.
   *
   * Not persisted to the agent registry — informational only at runtime.
   *
   * @public
   */
  metadata?: Record<string, unknown>;
}

/**
 * Artifact produced inside an agent's workspace. Cloud-only.
 *
 * @public
 */
export interface SDKArtifact {
  path: string;
  sizeBytes: number;
  updatedAt: string;
}

/**
 * Handle returned by `Agent.create()` and `Agent.resume()`.
 *
 * @public
 */
export interface SDKAgent {
  readonly agentId: string;
  readonly model: ModelSelection | undefined;
  /**
   * Context manager for this agent. Populated when context is enabled via
   * {@link AgentOptions.context}. See {@link SDKContextManager}.
   */
  readonly context?: SDKContextManager;
  /**
   * Provider routing inspector for this agent. Populated when at least one
   * provider route is configured (via {@link AgentOptions.providers}, plugins,
   * or model-implied providers). See {@link SDKProvidersManager}.
   */
  readonly providers?: SDKProvidersManager;
  /**
   * Skill listing for this agent. Populated when project-scoped skills are
   * enabled (`settingSources: ["project"]`) or when `skills.enabled` is set.
   * See {@link SDKAgentSkills}.
   */
  readonly skills?: SDKAgentSkills;
  /**
   * Plugin listing for this agent. Populated when project-scoped plugins are
   * enabled (`settingSources: ["plugins"]`) or when `plugins.enabled` is set.
   * See {@link SDKAgentPlugins}.
   */
  readonly plugins?: SDKAgentPlugins;
  send(message: string | SDKUserMessage, options?: SendOptions): Promise<Run>;
  /** Fire-and-forget disposal. */
  close(): void;
  /** Re-read filesystem config (context, hooks, project MCP, subagents) without disposing. */
  reload(): Promise<void>;
  /**
   * Async disposal. Idempotent — calling more than once is a no-op (per ADR D5).
   * Prefer `await using agent = await Agent.create(...)` over explicit
   * `dispose()` for resource safety.
   */
  dispose(): Promise<void>;
  /**
   * `await using` support per ADR D5. Identical semantics to `dispose()` —
   * idempotent across both surfaces.
   */
  [Symbol.asyncDispose](): Promise<void>;
  /** Cloud-only. Local returns an empty array. */
  listArtifacts(): Promise<SDKArtifact[]>;
  /** Cloud-only. Local throws `UnsupportedRunOperationError`. */
  downloadArtifact(path: string): Promise<Buffer>;
  /**
   * Signal that prompt cache should be invalidated. By default deferred —
   * applied at the start of the next `send()`. Pass `{ applyNow: true }` to
   * force immediate disposal (caller must `Agent.create()` again to use).
   *
   * Cache invalidation is a cost regression (provider charges full price
   * for the rebuilt cache; see ADRs D94-D95). Use sparingly and deliberately.
   *
   * Cloud agents: no-op (cloud runtime reconstructs state per request).
   *
   * @public
   */
  invalidateCache?(reason: string, options?: InvalidateCacheOptions): Promise<void>;
  /**
   * Goal-driven Ralph loop (ADRs D115-D121). Iterates `agent.send` →
   * judge → continuation until the auxiliary judge model returns `done`,
   * the judge fails too many times in a row, max turns are exhausted,
   * or the caller aborts via `AbortSignal`.
   *
   * Yields {@link import("./goal-events.js").GoalEvent} per state
   * transition; returns a {@link import("./goal-events.js").GoalResult}
   * summary as the generator's final value.
   *
   * Cloud agents throw {@link import("../errors.js").UnsupportedRunOperationError}
   * **synchronously** (no AsyncGenerator returned) — wrap in try/catch
   * if you support both runtimes.
   *
   * Caveat: do not call `agent.dispose()` mid-iteration; the next `send`
   * propagates the disposal error through the generator to the consumer.
   *
   * @public
   */
  runUntil?(
    goal: string,
    options?: import("./goal-events.js").GoalOptions,
  ): AsyncGenerator<
    import("./goal-events.js").GoalEvent,
    import("./goal-events.js").GoalResult,
    void
  >;
  /**
   * Fork a short-lived sub-agent with parent's credentials + system
   * prompt byte-identical (ADR D112 — cache hit) and a restricted tool
   * whitelist (ADR D111 — AsyncLocalStorage isolation).
   *
   * Cloud agents throw {@link import("../errors.js").UnsupportedRunOperationError}.
   *
   * @public
   */
  fork?(
    options: import("../internal/runtime/fork-agent.js").ForkOptions,
  ): Promise<import("../internal/runtime/fork-agent.js").ForkResult>;
}

/**
 * Options for {@link SDKAgent.invalidateCache}.
 *
 * @public
 */
export interface InvalidateCacheOptions {
  /**
   * When `true`, dispose the agent immediately so caller must recreate it
   * to continue. Default `false` (deferred — applied on next `send()`).
   */
  applyNow?: boolean;
}

/**
 * Metadata returned by `Agent.list()` and `Agent.get()`.
 *
 * @public
 */
export type SDKAgentInfo = {
  agentId: string;
  name: string;
  summary: string;
  lastModified: number;
  status?: "running" | "finished" | "error";
  createdAt?: number;
  archived?: boolean;
} & (
  | { runtime?: undefined }
  | { runtime: "local"; cwd?: string }
  | {
      runtime: "cloud";
      env?: CloudEnv;
      repos?: string[];
    }
);

/**
 * Options for `Agent.list()`.
 *
 * @public
 */
export type ListAgentsOptions = {
  limit?: number;
  cursor?: string;
} & (
  | { runtime?: undefined }
  | { runtime: "local"; cwd?: string }
  | {
      runtime: "cloud";
      prUrl?: string;
      includeArchived?: boolean;
      apiKey?: string;
    }
);

/**
 * Options for `Agent.get()`.
 *
 * @public
 */
export interface GetAgentOptions {
  cwd?: string;
  apiKey?: string;
}

/**
 * Options for `Agent.listRuns()`.
 *
 * @public
 */
export type ListRunsOptions = {
  limit?: number;
  cursor?: string;
} & ({ runtime?: "local"; cwd?: string } | { runtime: "cloud"; apiKey?: string });

/**
 * Options for `Agent.getRun()`. Cloud requires the parent `agentId`.
 *
 * @public
 */
export type GetRunOptions =
  | { runtime?: "local"; cwd?: string }
  | { runtime: "cloud"; agentId: string; apiKey?: string };

/**
 * Options for archive/unarchive/delete.
 *
 * @public
 */
export interface AgentOperationOptions {
  cwd?: string;
  apiKey?: string;
}

/**
 * Paginated list shape.
 *
 * @public
 */
export interface ListResult<T> {
  items: T[];
  nextCursor?: string;
}
