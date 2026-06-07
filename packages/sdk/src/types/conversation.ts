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
 * Single step inside an agent turn.
 *
 * @public
 */
export type ConversationStep =
  | { type: "assistantMessage"; message: AssistantMessage }
  | { type: "toolCall"; message: ToolCall }
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
