import type { ModelSelection } from "../../types/agent.js";
import type { ConversationTurn } from "../../types/conversation.js";
import type { SDKMessage } from "../../types/messages.js";
import type { RunStatus, SendOptions } from "../../types/run.js";
import type { LlmClient } from "../llm/types.js";
import type { McpClient } from "../mcp/client.js";
import type { HooksExecutor } from "../runtime/hooks/hooks-executor.js";
import type { SessionMessage } from "../runtime/session/agent-session.js";

/**
 * Minimal memory-tool spec accepted by the agent loop. Concrete shape lives
 * in `internal/memory/tools.ts`; we declare it inline here to avoid pulling
 * the memory module into the cheap loop-types contract.
 *
 * @internal
 */
export interface MemoryToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: Record<string, unknown>): Promise<string>;
}

/**
 * Internal mirror of the public {@link import("../../types/agent.js").CustomTool}
 * passed through the loop. Declared inline so the cheap loop-types contract
 * doesn't import the public types barrel.
 *
 * @internal
 */
export interface CustomToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (input: Record<string, unknown>) => string | Promise<string>;
}

/**
 * Resolved tool descriptor used by dispatch + executor modules.
 * Lives in loop-types so both tool-dispatch.ts and tool-executors.ts can
 * import it without creating a circular dependency.
 *
 * @internal
 */
export interface ResolvedTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  origin: "shell" | "mcp" | "memory" | "custom";
  mcpServerName?: string;
  mcpToolName?: string;
  /** Direct handler for `origin === "memory"` tools — returns JSON-encoded result string. */
  memoryHandler?: (input: Record<string, unknown>) => Promise<string>;
  /** Direct handler for `origin === "custom"` tools — user-supplied via `AgentOptions.tools`. */
  customHandler?: (input: Record<string, unknown>) => string | Promise<string>;
}

/**
 * Shared agent-loop types. Kept in their own module so the dispatch helpers
 * can import `AgentLoopInputs` without pulling the whole orchestrator file.
 *
 * @internal
 */

export interface AgentLoopInputs {
  agentId: string;
  runId: string;
  model: ModelSelection;
  systemPrompt?: string;
  userMessage: string;
  llm: LlmClient;
  mcp: Map<string, McpClient>;
  hooks: HooksExecutor;
  /** T4.2 — PluginManager whose `pre_tool_call` hooks fire BEFORE file-based hooks. */
  pluginManager?: import("../plugins/manager.js").PluginManager;
  shellCwd: string;
  shellSandbox: boolean;
  maxIterations?: number;
  /**
   * Production-Readiness #5 (ADR D318): caller-supplied `AbortSignal` from
   * `SendOptions.signal`, plus the agent's lifecycle controller. When fired
   * (user cancel, dispose, SIGTERM), the LLM `fetch()` is aborted at
   * transport level — tokens stop billing mid-stream.
   *
   * When undefined the loop uses a never-aborting placeholder signal
   * (legacy behavior).
   */
  signal?: AbortSignal;
  /**
   * Production-Readiness #4 (ADRs D315-D317): tool lifecycle observability
   * callbacks forwarded from `AgentOptions`. Wrapped around tool dispatch
   * so cost-tracking + audit log can correlate start/end/error events via
   * `callId`. Errors thrown by callbacks are swallowed.
   */
  onToolStart?: import("../../types/agent.js").AgentOptions["onToolStart"];
  onToolEnd?: import("../../types/agent.js").AgentOptions["onToolEnd"];
  onToolError?: import("../../types/agent.js").AgentOptions["onToolError"];
  /**
   * T4.2 (ADRs D90-D91): explicit iteration budget. When omitted, the loop
   * constructs one from `maxIterations`. Tests can inject a pre-configured
   * instance to verify grace-call / compression-cap semantics.
   */
  budget?: import("../runtime/budget/budget.js").IterationBudget;
  /** Fires after each completed conversation step (text turn or tool batch). */
  onStep?: SendOptions["onStep"];
  /** Fires per raw incremental update (text-delta, …) — finer than onStep. */
  onDelta?: SendOptions["onDelta"];
  /** Step-cap force-close: per-run tool gate forwarded to the LLM request (`tool_choice`). */
  toolChoice?: SendOptions["toolChoice"];
  /**
   * Prior conversation history (user + assistant turns) from previous
   * `agent.send()` calls on the same agent. Excludes the current user
   * message — that is supplied via `userMessage` and appended by the
   * loop. Empty array for first-send agents.
   */
  priorMessages?: ReadonlyArray<SessionMessage>;
  /**
   * Memory tools (`memory_search`, `memory_get`) to register with the LLM
   * when `AgentOptions.memory.enabled === true`. Appended to the shell + MCP
   * tool catalog in `collectTools`.
   */
  memoryTools?: ReadonlyArray<MemoryToolSpec>;
  /**
   * Inline custom tools declared via `AgentOptions.tools`. Appended to the
   * tool catalog after shell + MCP + memory, before the LLM call.
   */
  customTools?: ReadonlyArray<CustomToolSpec>;
  /** Telemetry handle (D34). No-op when disabled. */
  telemetry?: import("../telemetry/tracer.js").TelemetryHandle;
  /**
   * Pluggable budget tracker (SDK 2.0 Phase 2 / T2.1 — ADR D1 interface
   * inversion). When provided, the loop will call `track()` after each
   * LLM completion AND `check()` before each iteration. When undefined,
   * the legacy internal `IterationBudget` + `UsageAccumulator` remain
   * the sole authority.
   *
   * **Status (incremental Phase 2):** plumbed at the type surface only.
   * Runtime `track()` / `check()` calls land in a follow-up iteration.
   * Plumbing the option through now lets `Agent.create({ budgetTracker })`
   * thread the value down to the loop without further type changes when
   * the runtime hooks land.
   */
  budgetTracker?: import("../runtime/budget/budget-tracker.js").BudgetTracker;
  /**
   * Pluggable memory provider (SDK 2.0 Phase 1 / T1.4 — Hexagonal
   * Architecture interface inversion). When provided, the loop will
   * eventually call `init()` / `buildTools()` / `runActivePass()` /
   * `dispose()` at the appropriate kernel hooks. When undefined, the
   * legacy `Memory` class + `internal/memory/*` runtime files remain
   * the sole authority.
   *
   * **Status (incremental Phase 1):** plumbed at the type surface only.
   * Runtime lifecycle calls land in T1.5. Plumbing the option through
   * now lets `Agent.create({ memoryProvider })` thread the value down
   * to the loop without further type changes when the hooks land.
   */
  memoryProvider?: import("../runtime/memory/memory-provider.js").MemoryProvider;
}

/**
 * Structured error surfaced from the loop catch/error-event paths
 * (transport/provider failures). Set-once invariant — the first reaching
 * error wins; later errors in the same run are ignored (ADR D3, EC-3-A).
 *
 * @internal — finding-b fix (sdk-error-packaging-fix-plan v1.1)
 */
export interface AgentLoopErrorDetail {
  message: string;
  code?: string;
  cause?: unknown;
}

export interface AgentLoopOutput {
  events: SDKMessage[];
  finalStatus: RunStatus;
  result: string;
  conversation: ConversationTurn[];
  /**
   * Aggregated token usage across every LLM call in this loop (ADR D376).
   * Populated whenever ≥1 LLM call completed — including partial-failure
   * runs (EC-5). Undefined when zero LLM calls fired (e.g., abort before
   * first send, or fixture-mode path that bypasses this loop).
   */
  usage?: import("../../types/usage.js").TokenUsage;
  /**
   * Inferred pricing-based cost matching `usage` (ADR D377). Set when the
   * model has a pricing entry in the registry; `cost.status` is
   * `"estimated"` / `"unknown"` / `"included"` per D377.
   */
  cost?: import("../../types/usage.js").CostBreakdown;
  /**
   * Structured error from transport / provider failure (Finding B fix).
   * When set, `finalStatus === "error"`. Downstream surfaces (runtime,
   * `RunResult.error`) copy this verbatim. NEVER leaks as an assistant
   * message (the previous bug — sdk-error-packaging-fix-plan).
   */
  error?: AgentLoopErrorDetail;
  /**
   * M1-2 (T2.2): true when the loop stopped at its iteration ceiling with the
   * model still wanting to call tools (silent truncation). Copied verbatim onto
   * `RunResult.stoppedAtIterationLimit`.
   */
  stoppedAtIterationLimit?: boolean;
}
