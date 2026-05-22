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
  AgentRunError,
  AuthenticationError,
  ConfigurationError,
  IntegrationNotConnectedError,
  MemoryAdapterError,
  type MemoryAdapterErrorCode,
  NetworkError,
  RateLimitError,
  TheokitAgentError,
  UnknownAgentError,
  UnsupportedRunOperationError,
} from "./errors.js";
// Eval suite (Adoption Roadmap #2; ADRs D202-D213)
export { Eval, EvalAlreadyRunningError } from "./eval.js";
// Structured output via synthetic forced tool (ADR D33)
export {
  GenerateObjectError,
  type GenerateObjectOptions,
  type GenerateObjectResult,
} from "./generate-object.js";
// Handoffs (Adoption Roadmap #4; ADRs D214-D229)
export {
  Handoff,
  HandoffLoopError,
  HandoffNameCollisionError,
  HandoffPairLoopError,
  HandoffReceiverDisposedError,
  HandoffSelfReferenceError,
  handoffTo,
  RECOMMENDED_HANDOFF_PROMPT_PREFIX,
} from "./handoff.js";
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
// Memory adapter helpers (ADR D141)
export { extractRawId, mkMemoryId } from "./memory-adapter-helpers.js";
// Migration helper (ADR D44) — re-exported for use by the bin CLI.
export {
  type MigrateOptions,
  type MigrateResult,
  migrateSqliteToLance,
} from "./migrate.js";
export { Scorers } from "./scorers.js";
// Personality presets (Hermes #26, ADRs D160-D169)
// `PersonalityPreset` is declared in `types/agent.ts` and reaches consumers
// via the `types/*` star export below. The runtime registry class lives in
// `internal/` because it owns filesystem I/O — public access is via the
// `Agent.usePersonality(...)` method, not direct construction.
// Security namespace (secret redaction; ADR D68)
export { Security } from "./security.js";
// Path safety primitives (ADRs D79-D85) live at `@usetheo/sdk/path-safety`,
// not on the main barrel. That dedicated sub-export keeps the DTS bundle
// for `index.ts` decoupled from the `internal/runtime` graph (which has
// a known import cycle `types/agent.ts ↔ fork-agent.ts` that rollup-plugin-dts
// trips on whenever a path-guard symbol reaches into the main bundle).
// Streamed structured output (ADR D39)
export {
  type DeepPartial,
  StreamObjectError,
  type StreamObjectEvent,
  type StreamObjectOptions,
} from "./stream-object.js";
// Theokit namespace
export { Theokit, type TheokitRequestOptions } from "./theokit.js";
// Trajectory export (ADR D139) — opt-in ShareGPT converter
export { toShareGptTrajectory } from "./trajectory-helpers.js";
// Type contract
export type * from "./types/index.js";
