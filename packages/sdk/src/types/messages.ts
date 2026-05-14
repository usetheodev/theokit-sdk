import type { ModelSelection } from "./agent.js";

/**
 * Plain text content block emitted by the assistant or user.
 *
 * @public
 */
export interface TextBlock {
  type: "text";
  text: string;
}

/**
 * Tool invocation block emitted by the assistant.
 *
 * @public
 */
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  /** Tool args are not part of the stable schema. Treat as unknown and parse defensively. */
  input: unknown;
}

/**
 * Init metadata. Emitted once at the start of a run.
 *
 * @public
 */
export interface SDKSystemMessage {
  type: "system";
  subtype?: "init";
  agent_id: string;
  run_id: string;
  model?: ModelSelection;
  tools?: string[];
}

/**
 * Echo of the user prompt for this run.
 *
 * @public
 */
export interface SDKUserMessageEvent {
  type: "user";
  agent_id: string;
  run_id: string;
  message: { role: "user"; content: TextBlock[] };
}

/**
 * Model text output for this run.
 *
 * @public
 */
export interface SDKAssistantMessage {
  type: "assistant";
  agent_id: string;
  run_id: string;
  message: {
    role: "assistant";
    content: Array<TextBlock | ToolUseBlock>;
  };
}

/**
 * Reasoning content.
 *
 * @public
 */
export interface SDKThinkingMessage {
  type: "thinking";
  agent_id: string;
  run_id: string;
  text: string;
  thinking_duration_ms?: number;
}

/**
 * Tool invocation lifecycle event. Emitted at start with `args`, then again on
 * completion with `result`.
 *
 * Tool `args` and `result` are NOT part of the stable schema — treat as unknown.
 *
 * @public
 */
export interface SDKToolUseMessage {
  type: "tool_call";
  agent_id: string;
  run_id: string;
  call_id: string;
  name: string;
  status: "running" | "completed" | "error";
  args?: unknown;
  result?: unknown;
  truncated?: { args?: boolean; result?: boolean };
}

/**
 * Cloud run lifecycle transitions.
 *
 * @public
 */
export interface SDKStatusMessage {
  type: "status";
  agent_id: string;
  run_id: string;
  status: "CREATING" | "RUNNING" | "FINISHED" | "ERROR" | "CANCELLED" | "EXPIRED";
  message?: string;
}

/**
 * Task-level milestones and summaries.
 *
 * @public
 */
export interface SDKTaskMessage {
  type: "task";
  agent_id: string;
  run_id: string;
  status?: string;
  text?: string;
}

/**
 * Awaiting user input or approval.
 *
 * @public
 */
export interface SDKRequestMessage {
  type: "request";
  agent_id: string;
  run_id: string;
  request_id: string;
}

/**
 * Discriminated union of all stream events. Discriminate on `type`.
 *
 * All events include `agent_id` and `run_id`.
 *
 * @public
 */
export type SDKMessage =
  | SDKSystemMessage
  | SDKUserMessageEvent
  | SDKAssistantMessage
  | SDKThinkingMessage
  | SDKToolUseMessage
  | SDKStatusMessage
  | SDKTaskMessage
  | SDKRequestMessage;
