// Public API surface for @usetheo/sdk.
//
// Single source of truth for the contract: docs.md at the repository root.
// Locked names: see CLAUDE.md.

// Agent façade
export { Agent, type AgentPromptResult } from "./agent.js";

// DX helpers — agent construction patterns (ADR D22-D26)
export { AgentBuilder } from "./agent-builder.js";
export { type AgentFactory, createAgentFactory } from "./agent-factory.js";
// Task observability registry (Adoption Roadmap gap #2; ADRs D361-D374)
// Token budget + cost tracker (Adoption Roadmap gap #1 post-Tasks; ADRs D375-D388)
export {
  Budget,
  chargeAndCheckThresholds,
  computeCost,
  getPricingEntry,
  inferApiMode,
  normalizeUsage,
  preflightCheck,
  UsageAccumulator,
} from "./budget.js";
// Semantic cache (Adoption Roadmap #6; ADRs D249-D266)
export {
  Cache,
  CacheEmbedderError,
  CacheInvalidTtlError,
} from "./cache.js";
// Cron façade
export { Cron } from "./cron.js";
export { type DefineToolSpec, defineTool } from "./define-tool.js";
// Errors (runtime classes)
export {
  AgentRunError,
  type AgentRunErrorCode,
  AuthenticationError,
  BudgetExceededError,
  ConfigurationError,
  type ErrorCode,
  type ErrorMetadata,
  IntegrationNotConnectedError,
  InvalidTaskIdError,
  MemoryAdapterError,
  type MemoryAdapterErrorCode,
  NetworkError,
  RateLimitError,
  TaskNotFoundError,
  TheokitAgentError,
  UnknownAgentError,
  UnsupportedBudgetOperationError,
  UnsupportedRunOperationError,
  UnsupportedTaskOperationError,
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
export { FileSystemConversationStorage } from "./internal/persistence/conversation-storage-fs.js";
// Conversation storage adapters (Production-Readiness #1; ADRs D303-D306)
export { InMemoryConversationStorage } from "./internal/persistence/conversation-storage-memory.js";
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
// Live-agent registry (Production-Readiness #2; ADRs D307-D310) — type exports only,
// the runtime singleton is reached via `Agent.registry`.
export type {
  AgentRegistryOptions,
  EvictReason,
  LiveAgentRegistry,
} from "./internal/runtime/live-agent-registry.js";
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
export { Task, type TaskConfigureOptions, type TaskWorkContext, type TaskWorkFn } from "./task.js";
// Theokit namespace
export { Theokit, type TheokitRequestOptions } from "./theokit.js";
// Trajectory export (ADR D139) — opt-in ShareGPT converter
export { toShareGptTrajectory } from "./trajectory-helpers.js";
// Type contract
export type * from "./types/index.js";
// Workflows (Adoption Roadmap #5; ADRs D230-D248)
export {
  agentStep,
  fn,
  Workflow,
  WorkflowAlreadyRunningError,
  WorkflowBuilder,
  WorkflowCompensateNotImplementedError,
  WorkflowDuplicateStepIdError,
  WorkflowMaxIterationsExceededError,
  WorkflowNotSerializableError,
  WorkflowParallelError,
  WorkflowResumeStepNotFoundError,
  WorkflowSnapshotNotFoundError,
} from "./workflow.js";
