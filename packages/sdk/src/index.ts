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
// Memory subsystem (public surfaces)
export {
  type DreamingSweepOptions,
  type DreamingSweepResult,
  Memory,
} from "./memory.js";
// Theokit namespace
export { Theokit, type TheokitRequestOptions } from "./theokit.js";

// Type contract
export type * from "./types/index.js";
