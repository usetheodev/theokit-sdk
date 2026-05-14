import type { UserMessage } from "./conversation.js";

/**
 * Single tool call event. The internal `args` and `result` shapes are NOT stable.
 *
 * @public
 */
export interface ToolCall {
  callId: string;
  name: string;
  args?: unknown;
  result?: unknown;
}

/**
 * Incremental text token from the assistant.
 *
 * @public
 */
export interface TextDeltaUpdate {
  type: "text-delta";
  text: string;
}

/**
 * Incremental reasoning token.
 *
 * @public
 */
export interface ThinkingDeltaUpdate {
  type: "thinking-delta";
  text: string;
}

/**
 * Emitted when a reasoning block completes.
 *
 * @public
 */
export interface ThinkingCompletedUpdate {
  type: "thinking-completed";
  thinkingDurationMs: number;
}

/**
 * Tool call started — args committed.
 *
 * @public
 */
export interface ToolCallStartedUpdate {
  type: "tool-call-started";
  callId: string;
  toolCall: ToolCall;
  modelCallId: string;
}

/**
 * Tool call arguments streaming in incrementally.
 *
 * @public
 */
export interface PartialToolCallUpdate {
  type: "partial-tool-call";
  callId: string;
  toolCall: ToolCall;
  modelCallId: string;
}

/**
 * Tool call completed.
 *
 * @public
 */
export interface ToolCallCompletedUpdate {
  type: "tool-call-completed";
  callId: string;
  toolCall: ToolCall;
  modelCallId: string;
}

/**
 * Token count delta for usage tracking.
 *
 * @public
 */
export interface TokenDeltaUpdate {
  type: "token-delta";
  tokens: number;
}

/**
 * Conversation step started.
 *
 * @public
 */
export interface StepStartedUpdate {
  type: "step-started";
  stepId: number;
}

/**
 * Conversation step completed.
 *
 * @public
 */
export interface StepCompletedUpdate {
  type: "step-completed";
  stepId: number;
  stepDurationMs: number;
}

/**
 * Turn ended with usage summary.
 *
 * @public
 */
export interface TurnEndedUpdate {
  type: "turn-ended";
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
}

/**
 * User message appended to the conversation.
 *
 * @public
 */
export interface UserMessageAppendedUpdate {
  type: "user-message-appended";
  userMessage: UserMessage;
}

/** @public */
export interface SummaryUpdate {
  type: "summary";
  summary: string;
}

/** @public */
export interface SummaryStartedUpdate {
  type: "summary-started";
}

/** @public */
export interface SummaryCompletedUpdate {
  type: "summary-completed";
}

/** @public */
export interface ShellOutputDeltaUpdate {
  type: "shell-output-delta";
  event: Record<string, unknown>;
}

/**
 * Lowest-level raw update from a run. Pass `onDelta` to `agent.send()` to
 * consume these. Finer-grained than `SDKMessage` events.
 *
 * @public
 */
export type InteractionUpdate =
  | TextDeltaUpdate
  | ThinkingDeltaUpdate
  | ThinkingCompletedUpdate
  | ToolCallStartedUpdate
  | ToolCallCompletedUpdate
  | PartialToolCallUpdate
  | TokenDeltaUpdate
  | StepStartedUpdate
  | StepCompletedUpdate
  | TurnEndedUpdate
  | UserMessageAppendedUpdate
  | SummaryUpdate
  | SummaryStartedUpdate
  | SummaryCompletedUpdate
  | ShellOutputDeltaUpdate;
