// Public API surface for @theokit/sdk.
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
// M22 — code-defined inline skills (`createSkill`) usable alongside filesystem skills.
export { type CreateSkillSpec, createSkill, type InlineSkill } from "./create-skill.js";
// Semantic cache — EXTRACTED to `@theokit/sdk-cache` (SDK 2.0 split, Phase 3 / T3.1).
// Consumers: `import { Cache, CacheEmbedderError, CacheInvalidTtlError } from "@theokit/sdk-cache"`.
// Cron façade
export { Cron } from "./cron.js";
export { type DefineProviderOptions, defineProvider } from "./define-provider.js";
export { type DefineToolSpec, defineTool } from "./define-tool.js";
// Errors (runtime classes)
export {
  AgentDisposedError,
  AgentRunError,
  type AgentRunErrorCode,
  AuthenticationError,
  BudgetExceededError,
  ConfigurationError,
  type ErrorCode,
  type ErrorMetadata,
  IntegrationNotConnectedError,
  InvalidTaskIdError,
  isTransientError,
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
// Infrastructure building blocks (moved from @theokit/theocode — SDK LEGO pieces)
export { EventBus } from "./event-bus.js";
// Structured output via synthetic forced tool (ADR D33). M21 — `structuringModel` on
// GenerateObjectOptions (two-model reason→structure flow).
export {
  GenerateObjectError,
  type GenerateObjectOptions,
  type GenerateObjectResult,
} from "./generate-object.js";
// #57 — tool-result content guard options (SendOptions.toolResultGuard).
export type { ToolResultGuardOptions } from "./internal/agent-loop/tool-result-guard.js";
// Handoffs — EXTRACTED to `@theokit/sdk-handoff` (SDK 2.0 split, Phase 4 / T4.1).
// Consumers: `import { Handoff, handoffTo, ... } from "@theokit/sdk-handoff"`.
// Transitional: `Agent.create({ handoffs: [...] })` still works while
// @theokit/sdk-handoff is installed (lazy-imported via optional peer model).
// The preferred 2.x pattern is `plugins: [Handoff.asPlugin({ targets: [...] })]`.
export { FileSystemConversationStorage } from "./internal/persistence/conversation-storage-fs.js";
// Conversation storage adapters (Production-Readiness #1; ADRs D303-D306)
export { InMemoryConversationStorage } from "./internal/persistence/conversation-storage-memory.js";
// Process-level keyed mutex (SDK 2.0 Phase 2 physical-survey unblock —
// ADR-008). Public utility consumed by extracted packages
// (@theokit/sdk-budget, @theokit/sdk-memory) to share the SAME mutex
// Map registry across package boundaries. Required for ledger.ts
// (sdk-budget) + dreaming/run.ts (sdk-memory) to coordinate writes
// without racing. Stability guarantee: signature stable until sdk-core
// v3.0.
export { withCwdMutex } from "./internal/persistence/cwd-mutex.js";
// Plugin & extension system (v1.8 — ADRs D97-D109)
// EC-Cache absorbed: PreUserSendContext + PostAssistantReplyContext + PreUserSendResult
// added to barrel so extracted packages (sdk-cache, sdk-handoff) can type their
// .asPlugin() factories without reaching into ./internal/plugins sub-path.
export {
  definePlugin,
  type HookName,
  type Plugin,
  type PluginContext,
  type PostAssistantReplyContext,
  type PreToolCallContext,
  type PreToolCallDecision,
  type PreUserSendContext,
  type PreUserSendResult,
} from "./internal/plugins/types.js";
export type { ProviderProfile } from "./internal/providers/types.js";
// BudgetTracker interface (SDK 2.0 Phase 2 / T2.1 foundation — ADR D1).
// Kernel-facing contract for budget/usage tracking. Default impl lives in
// internal/budget/ today; will move to @theokit/sdk-budget in Phase 2.
// Consumers can supply a custom impl via `Agent.create({ budgetTracker })`
// (wiring lands in subsequent iteration).
export type {
  BudgetCheck,
  BudgetTotal,
  BudgetTracker,
  BudgetUsageEvent,
} from "./internal/runtime/budget/budget-tracker.js";
// Reference impl — pure counter, no USD pricing. Consumers can use as a
// fallback before @theokit/sdk-budget ships or as a worked example.
export {
  type CounterBudgetTrackerOptions,
  createCounterBudgetTracker,
} from "./internal/runtime/budget/budget-tracker-counter.js";
// M1-3 — stateless continuation-history rebuild (pure primitive)
export {
  buildReplayHistory,
  type ReplayHistoryOptions,
} from "./internal/runtime/context/replay-history.js";
// MemoryProvider port (SDK 2.0 Phase 1 / T1.1 foundation — Hexagonal
// Architecture). Kernel-facing contract for the memory subsystem.
// Default no-op impl ships with sdk; rich impl will ship in
// @theokit/sdk-memory. Consumers opt-in via Agent.create({ memoryProvider })
// (wiring lands in subsequent iteration). Mirrors BudgetTracker pattern.
export type {
  ActiveMemoryPassArgs,
  ActiveMemoryPassResult,
  MemoryProvider,
  MemoryProviderHandle,
  MemoryProviderInitOptions,
  RecordSessionSummaryArgs,
} from "./internal/runtime/memory/memory-provider.js";
// Reference impl — pure no-op, no recall, no tools. Consumers can use
// as fallback before @theokit/sdk-memory ships or as a worked example
// when authoring custom providers.
export { createNoopMemoryProvider } from "./internal/runtime/memory/memory-provider-noop.js";
// Live-agent registry (Production-Readiness #2; ADRs D307-D310) — type exports only,
// the runtime singleton is reached via `Agent.registry`.
export type {
  AgentRegistryOptions,
  EvictReason,
  LiveAgentRegistry,
} from "./internal/runtime/registry/live-agent-registry.js";
export { JobQueue, type JobQueueOptions } from "./job-queue.js";
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
export {
  applyMode,
  type PermissionAction,
  PermissionEngine,
  type PermissionEngineOptions,
  type PermissionMode,
  type PermissionRule,
} from "./permission-engine.js";
// M7-5: PermissionEngine -> plugin veto exemplar. SE1: mode layer + canUseTool gate.
export {
  createPermissionPlugin,
  type PermissionGate,
  type PermissionGateContext,
  type PermissionGateDecision,
  type PermissionPluginOptions,
} from "./permission-plugin.js";
// M23 — schema normalizer (Zod default; JSON Schema / ArkType / Valibot adapters).
export { type NormalizedJsonSchema, normalizeSchema } from "./schema-normalizer.js";
// Personality presets (Hermes #26, ADRs D160-D169)
// `PersonalityPreset` is declared in `types/agent.ts` and reaches consumers
// via the `types/*` star export below. The runtime registry class lives in
// `internal/` because it owns filesystem I/O — public access is via the
// `Agent.usePersonality(...)` method, not direct construction.
// Security namespace (secret redaction; ADR D68)
export { Security } from "./security.js";
// SE4 — session-management surface over ConversationStorage.
export { createSessionManager } from "./session-manager.js";
// M3 #62 — scoped session state helpers (app:/user:/temp:).
export { type SessionScope, scopedConversationId, sessionScopePrefix } from "./session-scope.js";
// Squad — sequential multi-agent team (composes Workflow+agentStep; cross-val Gap 1)
export { createSquad, type Squad, type SquadOptions, type SquadRun } from "./squad.js";
// Path safety primitives (ADRs D79-D85) live at `@theokit/sdk/path-safety`,
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
// Subscription primitives (G8 — ADRs D422-D429) live at the dedicated
// `@theokit/sdk/subscription` sub-export to keep them off the main `index.ts`
// DTS bundle (same isolation pattern as `path-safety` per tsup.config.ts
// header comment — the agent.ts ↔ fork-agent.ts cycle trips rollup-plugin-dts
// whenever a sub-entry reaches into `internal/runtime`).
// Consumers: `import { defineSubscription, tracked, subscribe } from "@theokit/sdk/subscription"`.
// Theokit namespace
export { Theokit, type TheokitRequestOptions } from "./theokit.js";
// Trajectory export (ADR D139) — opt-in ShareGPT converter
export { toShareGptTrajectory } from "./trajectory-helpers.js";
// CustomTool type — explicit re-export so rollup-dts surfaces it in the
// bundled .d.ts (the `export type *` indirection through `./types/index.js`
// does not propagate to the rollup-dts output reliably). Needed by extracted
// packages that author custom tools (e.g., @theokit/sdk-tools).
export type { CustomTool, SDKAgent } from "./types/agent.js";
export type { SessionMeta, SessionMetaPatch } from "./types/conversation-storage.js";
// Type contract
export type * from "./types/index.js";
// SE3 — multi-agent provenance. Explicit re-export so rollup-dts surfaces it in
// the bundled .d.ts (the `export type *` star does not reliably propagate — same
// reason as `CustomTool` above).
export type { MessageOrigin } from "./types/run.js";
// SE2 — typed runtime event stream (opt-in via SendOptions.onRunEvent).
export {
  emitRunEvent,
  type RunCompactBoundaryEvent,
  type RunEvent,
  type RunEventSink,
  type RunPermissionDeniedEvent,
  type RunRateLimitEvent,
  type RunTaskCompletedEvent,
  type RunTaskStartedEvent,
  type RunTaskUpdatedEvent,
  type RunToolProgressEvent,
} from "./types/run-events.js";
// SE4 — explicit type re-exports so rollup-dts surfaces them in the bundled .d.ts
// (the `export type *` star does not reliably propagate — same reason as CustomTool).
export type {
  SessionCapabilityResult,
  SessionListOptions,
  SessionManager,
  SessionSummary,
} from "./types/session.js";
