import type { ModelSelection } from "../../types/agent.js";
import type { ConversationTurn } from "../../types/conversation.js";
import type { SDKMessage } from "../../types/messages.js";
import type { RunStatus, SendOptions } from "../../types/run.js";
import type { LlmClient } from "../llm/types.js";
import type { McpClient } from "../mcp/client.js";
import type { HooksExecutor } from "../runtime/hooks-executor.js";

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
  shellCwd: string;
  shellSandbox: boolean;
  maxIterations?: number;
  /** Fires after each completed conversation step (text turn or tool batch). */
  onStep?: SendOptions["onStep"];
  /** Fires per raw incremental update (text-delta, …) — finer than onStep. */
  onDelta?: SendOptions["onDelta"];
}

export interface AgentLoopOutput {
  events: SDKMessage[];
  finalStatus: RunStatus;
  result: string;
  conversation: ConversationTurn[];
}
