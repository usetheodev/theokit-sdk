import type { ToolCall } from "./updates.js";

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
 * User-authored message in a conversation history.
 *
 * @public
 */
export interface UserMessage {
  text: string;
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
