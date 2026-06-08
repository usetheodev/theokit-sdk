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

/**
 * T3.5 — a single system-prompt block. Used by `LlmRequest.system` when the
 * caller wants to opt into Anthropic prompt caching: each block whose
 * `cacheable` is `true` gets the `cache_control: {type: 'ephemeral'}`
 * annotation in the Anthropic wire body, which lets Anthropic bill
 * subsequent same-content requests at the cache-read rate (1-3x discount).
 *
 * For providers that don't support prompt caching (OpenAI, OpenRouter, etc),
 * the array is joined into a single string at the wire boundary so the
 * upstream contract stays unchanged. Back-compat: `LlmRequest.system` still
 * accepts a plain `string` (pre-T3.5 callers compile unchanged).
 */
export interface LlmSystemBlock {
  text: string;
  /** When `true`, ask the provider to cache this block (Anthropic only). */
  cacheable?: boolean;
}

export interface LlmRequest {
  model: string;
  system?: string | LlmSystemBlock[];
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
  /** Cache read tokens (Anthropic prompt caching / OpenAI cached). ADR D376. */
  cacheReadTokens?: number;
  /** Cache creation tokens (Anthropic only). ADR D376. */
  cacheWriteTokens?: number;
  /** Reasoning tokens (OpenAI o-series). ADR D376. */
  reasoningTokens?: number;
}

export interface LlmClient {
  readonly name: string;
  stream(request: LlmRequest, signal: AbortSignal): AsyncGenerator<LlmEvent, LlmFinish, void>;
}
