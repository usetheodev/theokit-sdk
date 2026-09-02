/**
 * Owner: `internal/agent-loop/` (1 of 1 importers). Derived from the import graph, not declared —
 * `tests/lint/types-name-their-owner.test.ts` re-derives it.
 *
 */
// T4.1 / D438 — import from leaf to break the conversation<->updates cycle (#6).
import type { UserMessage } from "./messages-base.js";

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

/**
 * A conversation summary produced during a run, delivered through `SendOptions.onDelta`.
 *
 * Nothing in this package emits it. It is declared so an exhaustive `switch` over
 * {@link InteractionUpdate} compiles, and so a runtime that does produce summaries has a typed
 * channel — do not build a feature that waits on it against the local runtime.
 *
 * @public
 */
export interface SummaryUpdate {
  type: "summary";
  summary: string;
}

/**
 * Opens the bracket around a {@link SummaryUpdate}, for a UI that wants to show a pending state
 * before the summary text exists. Paired with {@link SummaryCompletedUpdate}.
 *
 * Like the summary variants around it, nothing in this package emits it.
 *
 * @public
 */
export interface SummaryStartedUpdate {
  type: "summary-started";
}

/**
 * Closes the bracket opened by {@link SummaryStartedUpdate}. Carries no payload — the summary text
 * itself arrives as {@link SummaryUpdate}.
 *
 * Like the summary variants around it, nothing in this package emits it.
 *
 * @public
 */
export interface SummaryCompletedUpdate {
  type: "summary-completed";
}

/**
 * Incremental output from a shell command running inside a run.
 *
 * `event` is an untyped bag on purpose: this package neither produces nor narrows it, so a consumer
 * that receives one should treat it as unvalidated input and check for the fields it needs rather
 * than casting. As with the summary variants, nothing here emits this — it exists so the
 * {@link InteractionUpdate} union covers a runtime that does.
 *
 * @public
 */
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
