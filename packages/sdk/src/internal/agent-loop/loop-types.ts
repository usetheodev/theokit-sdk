import type { ModelSelection } from "../../types/agent.js";
import type { ConversationTurn } from "../../types/conversation.js";
import type { SDKMessage } from "../../types/messages.js";
import type { RunStatus, SendOptions } from "../../types/run.js";
import type { LlmClient } from "../llm/types.js";
import type { McpClient } from "../mcp/client.js";
import type { SessionMessage } from "../runtime/agent-session.js";
import type { HooksExecutor } from "../runtime/hooks-executor.js";

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
   * T4.2 (ADRs D90-D91): explicit iteration budget. When omitted, the loop
   * constructs one from `maxIterations`. Tests can inject a pre-configured
   * instance to verify grace-call / compression-cap semantics.
   */
  budget?: import("../runtime/budget.js").IterationBudget;
  /** Fires after each completed conversation step (text turn or tool batch). */
  onStep?: SendOptions["onStep"];
  /** Fires per raw incremental update (text-delta, …) — finer than onStep. */
  onDelta?: SendOptions["onDelta"];
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
}

export interface AgentLoopOutput {
  events: SDKMessage[];
  finalStatus: RunStatus;
  result: string;
  conversation: ConversationTurn[];
}
