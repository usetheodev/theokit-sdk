import type { ContextSettings, SDKContextManager } from "./context.js";
import type { McpServerConfig } from "./mcp.js";
import type { PluginsSettings, ProviderRoutingSettings, SDKProvidersManager } from "./providers.js";
import type { Run, SDKUserMessage, SendOptions } from "./run.js";

// T4.1 / D438 — primitives now live in `./agent-prims.ts` (leaf file) so
// `./run.ts` and `./messages.ts` can reach them without cycling through
// `./agent.ts`. Re-exported here for back-compat with consumers that import
// `ModelSelection` / `ModelParameterValue` / `CustomTool` from `@theokit/sdk`.
export type {
  CustomTool,
  ModelParameterValue,
  ModelSelection,
  ToolContextMessage,
} from "./agent-prims.js";

// Code `Plugin` objects (the array form of `AgentOptions.plugins`) are the
// public discriminated union re-exported from the barrel. Type-only import —
// erased at compile, so the types↔internal reference introduces no runtime cycle.
import type { Plugin } from "../internal/plugins/types.js";
import type { CustomTool, ModelSelection } from "./agent-prims.js";

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
  /**
   * Tool whitelist (M4-6). When set, the sub-agent may ONLY call tools whose
   * canonical (post-repair, lowercase) name is in this list — any other tool
   * call is vetoed at dispatch via the same `withToolWhitelist` enforcement
   * forks use (NOT `PermissionEngine`). Absent/empty → unscoped (inherits the
   * parent's full toolset). Apply with `withSubagentToolScope`.
   */
  tools?: string[];
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
/**
 * A skill resolved WITH its body, returned by {@link SDKAgentSkills.get}. Unlike
 * {@link SystemPromptSkillRef} (name + description only), this carries the full
 * `instructions` — read from the SKILL.md for filesystem skills or the inline
 * `createSkill` body. @public
 */
export interface SDKAgentSkillDetail {
  name: string;
  description: string;
  instructions: string;
  /** SE21 — supporting documents bundled with the skill (filename → content), when present. */
  references?: Record<string, string>;
}

export interface SDKAgentSkills {
  list(): Promise<ReadonlyArray<SystemPromptSkillRef>>;
  /**
   * SE20 — resolve a skill by name INCLUDING its body (`instructions`). Returns
   * `undefined` when no enabled skill matches. `list()` stays lean (name +
   * description); full bodies come only through `get`.
   */
  get(name: string): Promise<SDKAgentSkillDetail | undefined>;
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
  /**
   * M22 — discover skills from a CUSTOM directory (containing `<name>/SKILL.md`) instead of the
   * default `<cwd>/.theokit/skills`. Absent ⇒ the default root.
   */
  skillsDir?: string;
  /**
   * M22 — code-defined skills (from `createSkill`) merged with the discovered ones. An inline skill
   * overrides a discovered file skill of the same name.
   */
  inline?: import("../create-skill.js").InlineSkill[];
}

/**
 * SE22 — context passed to a {@link SkillsResolver}. Mirrors
 * {@link SystemPromptContext} MINUS `skills`: the resolver runs BEFORE skills
 * are assembled, so the resolved list does not exist yet.
 *
 * @public
 */
export interface SkillsResolverContext {
  agentId: string;
  /** Workspace cwd. `string | undefined` mirrors {@link SystemPromptContext}; a local agent always passes a concrete path. */
  cwd: string | undefined;
  model: ModelSelection | undefined;
  userMessage: string;
  /** Recalled durable facts when memory is enabled. */
  memory: ReadonlyArray<SystemPromptMemoryFact>;
}

/**
 * SE22 — a resolver that produces {@link SkillsSettings} per run from runtime
 * context (e.g. the user's role). Mirrors the {@link SystemPromptResolver}
 * pattern: evaluated per `send()` BEFORE skill assembly, so a cached
 * `getOrCreate` agent re-resolves on every run.
 *
 * The SDK imposes NO timeout — wrap your own `Promise.race` for slow sources. A
 * throwing resolver fails the run (no silent fallback — Rule 8). Cloud agents
 * reject a function resolver (it can't run on PaaS); resolve to a static
 * {@link SkillsSettings} object before `Agent.create()`.
 *
 * @public
 */
export type SkillsResolver = (
  ctx: SkillsResolverContext,
) => SkillsSettings | Promise<SkillsSettings>;

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

// T4.1 / D438 — `CustomTool` moved to `./agent-prims.ts` (leaf file) and
// re-exported at the top of this module. Inline `import("./agent.js")` self-
// references that previously triggered madge self-cycle #3 have been removed
// in this same slice.

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
  /**
   * The model to run. SE8 — accepts a bare-string id shorthand
   * (`"openai/gpt-4o-mini"`, normalized to `{ id }`) OR a {@link ModelSelection}
   * object (use the object form to pass `params`).
   */
  model?: string | ModelSelection;
  /** Falls back to `THEOKIT_API_KEY`. */
  apiKey?: string;
  name?: string;
  /**
   * When `true`, `Agent.prompt` (and any helper that goes through `run.wait()`)
   * rejects with `AgentRunError` instead of resolving with `{ status: 'error' }`.
   * Cancelled runs (`status: 'cancelled'`) still resolve — cancel ≠ error.
   * If `result.error` is undefined despite `status: 'error'` (malformed RunResult),
   * the defensive guard resolves normally (no throw).
   *
   * Default `false` (backwards-compatible).
   *
   * @public
   */
  throwOnError?: boolean;
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
  /**
   * Plugins for this agent, in one of two forms:
   *
   * - **Named-enable settings** — `{ enabled: ["name", ...] }`. Selects which
   *   file-discovered plugin providers (under `.theokit/plugins/`) are active.
   *   Plugin sources must also be active via `local.settingSources`.
   * - **Code `Plugin` objects** — an array of `Plugin` instances, e.g.
   *   `plugins: [Handoff.asPlugin({ ... })]`. These are registered directly by
   *   the runtime (`extractCodePlugins`); no `settingSources` entry is needed.
   *
   * The two forms are mutually exclusive — pass one or the other.
   */
  plugins?: PluginsSettings | readonly Plugin[];
  /**
   * SE1 — the default permission mode for this agent's runs, threaded to a
   * registered `PermissionPlugin`'s pre-tool gate. A per-send
   * `SendOptions.permissionMode` overrides it. Absent ⇒ the plugin's own
   * construction-time mode applies. Local runtime.
   */
  permissionMode?: import("../permission-engine.js").PermissionMode;
  /**
   * Skills configuration. Either a static {@link SkillsSettings} object or —
   * SE22 — a {@link SkillsResolver} evaluated per `send()` to pick skills from
   * runtime context (e.g. user role). A cached agent re-resolves each run. The
   * agent-scoped `agent.skills` handle reflects the STATIC/base config; the
   * resolver drives the per-send `<skills>` block.
   */
  skills?: SkillsSettings | SkillsResolver;
  /**
   * SE24 — guardrail processors. `inputProcessors` run in order before the LLM
   * (normalize / validate / block / rewrite the user message); `outputProcessors`
   * run on the model's final text before it reaches the caller (redact / block).
   * A processor that `abort()`s stops the run with a {@link RunResult.tripwire}
   * (+ a `tripwire` run-event). Empty/absent ⇒ unchanged behavior. See
   * {@link Processor}.
   */
  inputProcessors?: readonly import("./processors.js").Processor[];
  outputProcessors?: readonly import("./processors.js").Processor[];
  /** Memory configuration. Persists durable facts; auto-recalled on send. */
  memory?: MemorySettings;
  /**
   * SE33 — standing goal config for a DURABLE, thread-scoped objective (Mastra
   * Goals parity). Read when a durable objective (`setObjective`) is set: the
   * per-objective values take precedence over this config, which takes
   * precedence over the built-in defaults. The judge is the activation switch —
   * with no `judgeModel` resolved, a standing objective is inert. ADR 0012.
   */
  goal?: import("./objective.js").AgentGoalConfig;
  /**
   * Inline custom tools. Local runtime only — cloud agents reject any non-empty
   * `tools` array. Handlers are not persisted; pass them again on resume.
   * See {@link CustomTool}.
   */
  tools?: CustomTool[];
  /**
   * SE37 — opt-in reasoning. When `true`, the agent gets a chain-of-thought
   * preamble prepended to its system prompt AND the `think` reasoning tool
   * auto-attached, turning a non-reasoning model into a reason -> act ->
   * observe loop (same model; reuses the existing tool loop). Default `false` —
   * byte-identical behaviour when unset. Inert (with a one-time warn) when a
   * native reasoning model is configured (`model.params: [{ id: "thinking" }]`),
   * so native and prompt-based reasoning never stack. See `ReasoningTools` in `@theokit/sdk-tools`.
   */
  reasoning?: boolean;
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
  /**
   * Default `MemoryContext` for third-party memory adapter plugins
   * (ADR D141). When set, `pre_user_send` / `post_assistant_reply`
   * hooks receive this context unless the caller overrides it. The
   * `agent.memory` direct API also defaults to it.
   *
   * @public
   */
  memoryContext?: import("./memory-adapter.js").MemoryContext;
  /**
   * Maximum byte length of the `<memory-context>` block injected by
   * `pre_user_send` adapter hooks (EC-A). Larger recalls are sliced
   * with `…[truncated]`. Default 16_000 (~4k tokens). Set lower for
   * cheaper turns; higher for longer-context models.
   *
   * @public
   */
  maxRecallContextBytes?: number;
  /**
   * Declarative handoff destinations (Adoption Roadmap #4; ADRs D214-D229).
   * Each entry is either a raw `SDKAgent` (auto-wrapped with defaults) OR a
   * `HandoffDescriptor` from `Handoff.create(target, opts?)`.
   *
   * Runtime injects synthetic `transfer_to_<receiver.name>` tools per
   * destination (D214/D215). When the LLM invokes one, the receiver takes
   * over the next turn (peer-to-peer, D217).
   *
   * @public
   */
  // SDK 2.0 split (Phase 4): handoff-descriptor.ts moved to @theokit/sdk-handoff.
  // The handoffs field is TRANSITIONAL — preferred 2.x pattern is
  // `plugins: [Handoff.asPlugin({ targets: [...] })]` (see migration guide).
  // Type loosened to `unknown` here because the kernel must not import from
  // an extension; consumers using this option must have @theokit/sdk-handoff
  // installed (optional peer — see agent.ts maybeInjectHandoffTools).
  // EC-4 absorbed in plan v1.1 removes this field entirely in Phase 6 cohort.
  handoffs?: ReadonlyArray<SDKAgent | unknown>;
  /**
   * Maximum chain depth across handoffs per `agent.send()` call (D218).
   * Default 5. Exceeding throws `HandoffLoopError`. Set to 0 to disable
   * the handoff tools entirely (EC-8 / handoffs never fire).
   *
   * @public
   */
  maxHandoffDepth?: number;
  /**
   * Production-Readiness #6 — quota / abuse gates (ADRs D322-D323).
   *
   * `onBeforeCreate` fires BEFORE the agent is registered or persisted —
   * throw to block creation. `onBeforeSend` fires BEFORE each `agent.send`
   * (after `pre_user_send` adapter hooks, before any LLM call or storage
   * write) — throw to block the send.
   *
   * Unlike `onTool*` (observation), these hooks are BLOCKERS — errors
   * propagate as rejection on `Agent.create` / `agent.send`. Use them for
   * per-user conversation caps, per-conversation message caps, abuse
   * detection.
   *
   * @public
   */
  onBeforeCreate?: (event: { conversationId: string; userId?: string }) => Promise<void> | void;
  /**
   * Fires before each `agent.send`. `previousMessageCount` is the count of
   * messages already persisted BEFORE the current send adds the user
   * message. Throw to block.
   *
   * @public
   */
  onBeforeSend?: (event: {
    conversationId: string;
    previousMessageCount: number;
  }) => Promise<void> | void;
  /**
   * Production-Readiness #4 — tool lifecycle hooks (ADRs D315-D317).
   *
   * `onToolStart` fires BEFORE the handler runs. `onToolEnd` fires after a
   * successful handler return. `onToolError` fires when validation fails OR
   * the handler throws — `event.error` is always an `Error` instance.
   *
   * Hook errors are SWALLOWED with a stderr warn (do not abort the run).
   * The `callId` is unique per tool invocation and identical across the
   * start/end (or start/error) pair, so consumers can correlate.
   *
   * Use cases: cost tracking, audit logs, per-tool retry/alerting,
   * latency telemetry.
   *
   * @public
   */
  onToolStart?: (event: {
    toolName: string;
    args: unknown;
    conversationId: string;
    callId: string;
  }) => void | Promise<void>;
  /** Fires when a tool handler returns successfully. */
  onToolEnd?: (event: {
    toolName: string;
    args: unknown;
    result: unknown;
    conversationId: string;
    callId: string;
    durationMs: number;
  }) => void | Promise<void>;
  /**
   * Fires when a tool handler throws OR schema validation rejects the args.
   * `event.error` is always an `Error` instance (D315/EC-6 — validation
   * reasons are wrapped in `new Error(reason)`).
   *
   * `attempt` is always `1` in v1 (D317 — reserved for future retry policy).
   */
  onToolError?: (event: {
    toolName: string;
    args: unknown;
    error: Error;
    conversationId: string;
    callId: string;
    durationMs: number;
    attempt: number;
  }) => void | Promise<void>;
  /**
   * Pluggable conversation persistence (Production-Readiness #1; ADRs D303-D306).
   *
   * Default: undefined → `FileSystemConversationStorage` writing to
   * `<cwd>/.theokit/agents/<id>/messages.jsonl` (byte-identical to pre-D303
   * behavior). Pass `InMemoryConversationStorage` for tests, or a custom
   * adapter (Postgres/Redis/Durable Objects) for serverless and multi-host
   * deploys.
   *
   * NOTE: not persisted in the registry snapshot — closures don't serialize.
   * On `Agent.resume`, pass the adapter again. If the agent was originally
   * created with a custom `conversationStorage`, resume without it throws
   * `ConfigurationError(code: "conversation_storage_required")` (D325) to
   * avoid silent FS fallback that would lose history.
   *
   * @public
   */
  conversationStorage?: import("./conversation-storage.js").ConversationStorageAdapter;

  /**
   * Pluggable budget/usage tracker (SDK 2.0 Phase 2 / T2.1 — ADR D1 interface
   * inversion). When provided, the agent loop calls `tracker.track(...)`
   * after each LLM completion and `tracker.check()` before each iteration.
   *
   * **Status (Phase 2 incremental):** the option is wired to the type
   * surface only. Agent-loop runtime wiring is additive and lands in a
   * subsequent iteration — for now, the kernel still uses the legacy
   * `UsageAccumulator` + `IterationBudget` from `internal/budget/`.
   * Consumers passing a custom tracker today get the type guarantee but
   * NOT runtime enforcement.
   *
   * Default impls available today via `@theokit/sdk`:
   *   - `createCounterBudgetTracker({ maxTokens, maxIterations })`
   *
   * Future: post-Phase-2, `@theokit/sdk-budget` ships a richer impl with
   * USD pricing.
   *
   * @public
   */
  budgetTracker?: import("../internal/runtime/budget/budget-tracker.js").BudgetTracker;

  /**
   * Pluggable memory subsystem (SDK 2.0 Phase 1 / T1.3 — Hexagonal
   * Architecture interface inversion). When provided, the agent loop
   * calls `provider.init(...)` once per agent, surfaces tools from
   * `provider.buildTools(...)` to the LLM, runs `provider.runActivePass(...)`
   * pre-LLM to inject recalled facts, and `provider.dispose(...)` on
   * Agent shutdown.
   *
   * **Status (Phase 1 incremental):** the option is wired to the type
   * surface only. Agent-loop runtime wiring is additive and lands in
   * subsequent iterations (T1.4 plumbing, T1.5 runtime hooks). For now,
   * the kernel still uses the legacy `Memory` class + `internal/memory/*`
   * runtime files. Consumers passing a custom provider today get the type
   * guarantee but NOT runtime enforcement.
   *
   * Default impls available today via `@theokit/sdk`:
   *   - `createNoopMemoryProvider()` — degenerate fallback / worked example
   *
   * Future: post-Phase-1, `@theokit/sdk-memory` ships a rich impl with
   * LanceDB / embeddings / circuit breaker / active-memory cache.
   *
   * @public
   */
  memoryProvider?: import("../internal/runtime/memory/memory-provider.js").MemoryProvider;
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
  /**
   * SE9 — integrated structured output. Runs the normal tool loop (the tools run
   * first) then coerces the final answer into the `output` Zod schema, returning a
   * validated, inferred-typed object. Sugar over `Agent.generateObject` (ADR D33).
   */
  generate<T extends import("zod").ZodType>(
    message: string | SDKUserMessage,
    options: import("./run.js").GenerateOptions<T>,
  ): Promise<import("./run.js").GenerateRunResult<import("zod").z.infer<T>>>;
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
    goal?: string,
    options?: import("./goal-events.js").GoalOptions,
  ): import("./goal-events.js").RunUntilIterator;
  /**
   * SE33 — set a DURABLE, thread-scoped objective persisted via the
   * conversation storage (survives reload). Read by `runUntil()` when no
   * explicit goal is passed. `threadId` is REQUIRED (the durability key); the
   * call no-ops when the run is not memory-backed (the storage adapter omits the
   * optional objective methods). Throws `ConfigurationError` on `maxRuns <= 0`.
   * ADR 0012.
   */
  setObjective?(
    objective: string,
    opts: { threadId: string } & import("./objective.js").DurableGoalOptions,
  ): Promise<void>;
  /** SE33 — read the durable objective record for a thread (or `undefined`). */
  getObjective?(opts: {
    threadId: string;
  }): Promise<import("./objective.js").ObjectiveRecord | undefined>;
  /** SE33 — merge options into the active objective (only provided fields change; no-op if unset). */
  updateObjectiveOptions?(
    opts: { threadId: string } & import("./objective.js").DurableGoalOptions,
  ): Promise<void>;
  /** SE33 — drop the durable objective for a thread. */
  clearObjective?(opts: { threadId: string }): Promise<void>;
  /**
   * Fork a short-lived sub-agent with parent's credentials + system
   * prompt byte-identical (ADR D112 — cache hit) and a restricted tool
   * whitelist (ADR D111 — AsyncLocalStorage isolation).
   *
   * Cloud agents throw {@link import("../errors.js").UnsupportedRunOperationError}.
   *
   * @public
   */
  fork?(options: import("./fork.js").ForkOptions): Promise<import("./fork.js").ForkResult>;
  /**
   * Drive `send` to completion across iteration-ceiling truncations (M1 Phase 3).
   * When a `send` stops at the loop's iteration cap (`RunResult.stoppedAtIterationLimit`),
   * this re-sends a short continuation prompt — the agent's stateful session
   * preserves the conversation — until a genuine terminal: `done` (finished),
   * `step_limit` (`maxRounds` exhausted), or `no_progress` (two empty rounds).
   *
   * Local agents only. Cloud agents throw
   * {@link import("../errors.js").UnsupportedRunOperationError} (the cloud
   * runtime manages its own continuation policy server-side).
   *
   * @public
   */
  runToCompletion?(
    message: string,
    options?: import("./run.js").RunToCompletionOptions,
  ): Promise<import("./run.js").RunToCompletionResult>;
  /**
   * STREAMING continuation driver (V3-4) — the streaming twin of
   * {@link SDKAgent.runToCompletion}. Returns an `AsyncGenerator` that yields each
   * round's {@link import("./messages.js").SDKMessage}s LIVE (for a UI), reusing the
   * same terminal policy (`done`/`step_limit`/`no_progress` + bounded re-prompt).
   *
   * The {@link import("./run.js").StreamToCompletionResult} is the generator's RETURN
   * value — read it via a manual `gen.next()` loop (`while (!res.done) res = await
   * gen.next()` → `res.value`); a plain `for await...of` consumes the yielded
   * messages but discards the return value. For the STATELESS path, reconstruct
   * history with `buildReplayHistory` into a fresh session first.
   *
   * Local agents only. Cloud agents throw
   * {@link import("../errors.js").UnsupportedRunOperationError}.
   *
   * @public
   */
  streamToCompletion?(
    message: string,
    options?: import("./run.js").RunToCompletionOptions,
  ): AsyncGenerator<
    import("./messages.js").SDKMessage,
    import("./run.js").StreamToCompletionResult
  >;
  /**
   * Direct API to third-party memory adapter(s) registered via
   * `plugins: [...]` (ADR D141 / D142). Returns `null` when no adapter
   * is registered. In multi-adapter setups `write` fans out to all;
   * `recall` merges + dedupes; `delete` routes by `MemoryId` prefix.
   *
   * @public
   */
  memory?: import("./memory-adapter.js").AgentMemory;
  /**
   * Activate a personality preset for the next `send` (Hermes #26).
   * Reserved names `"none"`, `"default"`, and `"neutral"` clear the
   * active preset. Returns the resolved preset (or `null` when cleared).
   *
   * Persistence: pass `{ save: true }` to persist across process
   * restarts (stored under `$THEOKIT_HOME/personality.json`).
   *
   * History: by default the conversation history is preserved across
   * the switch. Pass `{ reset: true }` to also clear the session.
   *
   * Cloud agents throw {@link import("../errors.js").UnsupportedRunOperationError}.
   *
   * @public
   */
  usePersonality?(
    name: string,
    opts?: { save?: boolean; reset?: boolean },
  ): Promise<PersonalityPreset | null>;
}

/**
 * Resolved personality preset surfaced via {@link SDKAgent.usePersonality}
 * (Hermes #26, ADRs D160-D169). Re-declared here so the public DTS bundle
 * never crosses the `internal/` path boundary. The implementation type in
 * `internal/personality/types.ts` is structurally identical.
 *
 * @public
 */
export interface PersonalityPreset {
  readonly name: string;
  readonly description: string | undefined;
  readonly tools: ReadonlyArray<string> | undefined;
  readonly model: string | undefined;
  readonly tags: ReadonlyArray<string> | undefined;
  readonly systemPrompt: string;
  readonly source: "project" | "user";
  readonly sourcePath: string;
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
