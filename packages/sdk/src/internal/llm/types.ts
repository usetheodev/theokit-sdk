/**
 * Provider-agnostic LLM types used by the real agent loop. Each concrete
 * provider client (`anthropic.ts`, `openai.ts`) accepts an `LlmRequest`
 * and yields a stream of `LlmEvent`s plus a final `LlmFinish` shape that
 * the agent loop converts into our `SDKMessage` events.
 *
 * @internal
 */

export interface LlmTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LlmTextPart {
  type: "text";
  text: string;
}

export interface LlmToolCallPart {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LlmToolResultPart {
  type: "tool_result";
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export type LlmContentPart = LlmTextPart | LlmToolCallPart | LlmToolResultPart;

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: LlmContentPart[];
}

export interface LlmRequest {
  model: string;
  system?: string;
  messages: LlmMessage[];
  tools?: LlmTool[];
  maxTokens?: number;
  temperature?: number;
}

export type LlmEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "stop"; reason: LlmStopReason }
  | { type: "error"; message: string };

export type LlmStopReason = "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "error";

export interface LlmFinish {
  stopReason: LlmStopReason;
  text: string;
  toolCalls: LlmToolCallPart[];
  inputTokens?: number;
  outputTokens?: number;
}

export interface LlmClient {
  readonly name: string;
  stream(request: LlmRequest, signal: AbortSignal): AsyncGenerator<LlmEvent, LlmFinish, void>;
}
