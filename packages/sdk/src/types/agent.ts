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
  send(message: string | SDKUserMessage, options?: SendOptions): Promise<Run>;
  /** Fire-and-forget disposal. */
  close(): void;
  /** Re-read filesystem config (context, hooks, project MCP, subagents) without disposing. */
  reload(): Promise<void>;
  /**
   * Async disposal. Implementations also expose `[Symbol.asyncDispose]` so
   * `await using` works once the consuming TypeScript target enables it.
   */
  dispose(): Promise<void>;
  /** Cloud-only. Local returns an empty array. */
  listArtifacts(): Promise<SDKArtifact[]>;
  /** Cloud-only. Local throws `UnsupportedRunOperationError`. */
  downloadArtifact(path: string): Promise<Buffer>;
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
