// Public API surface for @usetheo/sdk.
//
// Single source of truth for the contract: docs.md at the repository root.
// Locked names: see CLAUDE.md.

// Agent façade
export { Agent, type AgentPromptResult } from "./agent.js";

// Cron façade
export { Cron } from "./cron.js";

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

// Theokit namespace
export { Theokit, type TheokitRequestOptions } from "./theokit.js";

// Type contract
export type * from "./types/index.js";
