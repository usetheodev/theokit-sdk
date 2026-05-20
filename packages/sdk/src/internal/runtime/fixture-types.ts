import type { AgentDefinition, AgentOptions, ModelSelection } from "../../types/agent.js";
import type { ConversationTurn } from "../../types/conversation.js";
import type { SDKMessage } from "../../types/messages.js";
import type { RunStatus, SendOptions } from "../../types/run.js";
import type { SessionMessage } from "./agent-session.js";
import type { MemoryFact } from "./memory-store.js";

/**
 * Pre-computed fixture script for a single Run. The local/cloud Run impls
 * play this back to consumers — events for `stream()`, finalStatus + result
 * for `wait()`, structured conversation for `run.conversation()`, and an
 * optional async hook for side effects (memory persistence, etc.).
 *
 * @internal
 */
export interface FixtureScript {
  events: SDKMessage[];
  finalStatus: RunStatus;
  result?: string;
  cancellable: boolean;
  conversation: ConversationTurn[];
  /** Extra fields surfaced on the RunResult (e.g. provider routing info). */
  extraRunFields?: Record<string, unknown>;
  /**
   * Structured error attached to the final RunResult when finalStatus is
   * `"error"`. Mirrors {@link RunResult.error} so callers that wait()
   * instead of stream() can still surface the cause.
   */
  errorDetail?: { message: string; code?: string; cause?: unknown };
  /** Optional async hook executed before the run terminates. */
  beforeComplete?: () => Promise<void>;
}

/**
 * Input the responder uses to pattern-match the user message and build the
 * appropriate script. Includes everything the responder needs to react to
 * the agent's configured capabilities.
 *
 * @internal
 */
export interface FixtureRequest {
  agentId: string;
  runId: string;
  model: ModelSelection;
  userMessage: string;
  runtime: "local" | "cloud";
  agentOptions: AgentOptions;
  sendOptions: SendOptions;
  workspaceCwd: string | undefined;
  subagents: Record<string, AgentDefinition>;
  settingSourcesIncludeProject: boolean;
  memoryFacts: MemoryFact[];
  sessionMessages: SessionMessage[];
  projectMcpServers: Record<string, unknown>;
  /** Async hook invoked when "Remember:" patterns persist a new fact. */
  persistMemoryFact?: (fact: MemoryFact) => Promise<void>;
}
