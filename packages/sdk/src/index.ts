// Public API surface for @usetheo/sdk.
//
// Single source of truth for the contract: docs.md at the repository root.
// Locked names: see CLAUDE.md.

// Agent façade
export { Agent, type AgentPromptResult } from "./agent.js";

// DX helpers — agent construction patterns (ADR D22-D26)
export { AgentBuilder } from "./agent-builder.js";
export { type AgentFactory, createAgentFactory } from "./agent-factory.js";
// Cron façade
export { Cron } from "./cron.js";
export { type DefineToolSpec, defineTool } from "./define-tool.js";
// Errors (runtime classes)
export {
  AuthenticationError,
  ConfigurationError,
  IntegrationNotConnectedError,
  NetworkError,
  RateLimitError,
  TheokitAgentError,
  UnknownAgentError,
  UnsupportedRunOperationError,
} from "./errors.js";
// Structured output via synthetic forced tool (ADR D33)
export {
  GenerateObjectError,
  type GenerateObjectOptions,
  type GenerateObjectResult,
} from "./generate-object.js";
// Plugin & extension system (v1.8 — ADRs D97-D109)
export {
  definePlugin,
  type HookName,
  type Plugin,
  type PluginContext,
  type PreToolCallContext,
  type PreToolCallDecision,
} from "./internal/plugins/types.js";
export type { ProviderProfile } from "./internal/providers/types.js";
// Memory subsystem (public surfaces)
export {
  type DreamingSweepOptions,
  type DreamingSweepResult,
  Memory,
} from "./memory.js";
// Migration helper (ADR D44) — re-exported for use by the bin CLI.
export {
  type MigrateOptions,
  type MigrateResult,
  migrateSqliteToLance,
} from "./migrate.js";
// Security namespace (secret redaction; ADR D68)
export { Security } from "./security.js";
// Streamed structured output (ADR D39)
export {
  type DeepPartial,
  StreamObjectError,
  type StreamObjectEvent,
  type StreamObjectOptions,
} from "./stream-object.js";
// Theokit namespace
export { Theokit, type TheokitRequestOptions } from "./theokit.js";

// Type contract
export type * from "./types/index.js";
