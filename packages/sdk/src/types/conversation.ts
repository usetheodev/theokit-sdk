/**
 * Owner: `internal/agent-loop/` (4 of 8 importers). Derived from the import graph, not
 * declared — `tests/lint/types-name-their-owner.test.ts` re-derives it.
 *
 */
import type { ToolCall } from "./updates.js";

// T4.1 / D438 — `UserMessage` moved to `./messages-base.ts` (leaf file) so
// `./updates.ts` can reach it without cycling back through this module.
// Re-exported here for back-compat with `import type { UserMessage } from "@theokit/sdk"`.
export type { UserMessage } from "./messages-base.js";

import type { UserMessage } from "./messages-base.js";

/**
 * Plain assistant message in a conversation history.
 *
 * @public
 */
export interface AssistantMessage {
  text: string;
}

/**
 * Reasoning step in a conversation history.
 *
 * @public
 */
export interface ThinkingMessage {
  text: string;
  thinkingDurationMs?: number;
  /**
   * theokit#122 — the provider's cryptographic signature for this thinking block, when it issued
   * one. Persisted with the block so a resumed conversation can replay it byte-identically;
   * Anthropic rejects a modified or unsigned thinking block with
   * `400 "thinking blocks cannot be modified"`.
   */
  signature?: string;
}

/**
 * Shell command executed during a run.
 *
 * @public
 */
export interface ShellCommand {
  command: string;
  workingDirectory?: string;
}

/**
 * Output of a shell command.
 *
 * @public
 */
export interface ShellOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Result of a tool invocation. Pairs with the preceding `toolCall` step
 * by `callId`. `isError: true` when the tool returned a failure result.
 *
 * T2.3 — added so `Run.conversation()` surfaces the full interaction
 * including tool results (parity with OpenAI Agents `RunResult.new_items`).
 *
 * @public
 */
export interface ToolResult {
  callId: string;
  name: string;
  result: string;
  isError: boolean;
}

/**
 * A single step inside an agent turn, discriminated by `type`: an assistant message, a tool call, the
 * tool result that pairs with it, or a thinking block.
 *
 * It reaches a caller by two routes that are NOT the same set. `Run.conversation()` returns the
 * accumulated steps of a finished turn and includes `thinkingMessage`. `SendOptions.onStep` fires
 * live while the turn runs and emits `assistantMessage`, `toolCall` and `toolResult` — but never
 * `thinkingMessage`, which the loop builds only into the accumulated conversation. A UI that wants
 * reasoning as it happens should read the `thinking-delta` / `thinking-completed` variants of
 * `InteractionUpdate` through `onDelta` instead.
 *
 * `toolCall` and its `toolResult` arrive as an ordered pair matched by `callId`; a call whose result
 * never came back has no `toolResult` step, so do not assume they alternate. Where a
 * `thinkingMessage` exists it precedes the `assistantMessage` of the same turn — that is the order
 * the provider requires of the message the block belongs to, not a presentation choice.
 *
 * @public
 */
export type ConversationStep =
  | { type: "assistantMessage"; message: AssistantMessage }
  | { type: "toolCall"; message: ToolCall }
  | { type: "toolResult"; message: ToolResult }
  | { type: "thinkingMessage"; message: ThinkingMessage };

/**
 * Agent turn: user message + assistant/tool/thinking steps.
 *
 * @public
 */
export interface AgentConversationTurn {
  userMessage?: UserMessage;
  steps: ConversationStep[];
}

/**
 * Shell turn: a command and its output.
 *
 * @public
 */
export interface ShellConversationTurn {
  shellCommand?: ShellCommand;
  shellOutput?: ShellOutput;
}

/**
 * Structured per-turn view of a run.
 *
 * @public
 */
export type ConversationTurn =
  | { type: "agentConversationTurn"; turn: AgentConversationTurn }
  | { type: "shellConversationTurn"; turn: ShellConversationTurn };
