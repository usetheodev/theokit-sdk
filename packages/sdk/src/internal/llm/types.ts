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
  /**
   * SE7 — a string (the common case) OR structured content blocks (text +
   * image). Block-capable provider wires forward blocks natively; string-only
   * wires flatten text and fail fast on an image (`toStringToolResultContent`).
   */
  content: string | import("../../types/content-blocks.js").ToolResultContentBlock[];
  isError?: boolean;
}

/**
 * M35 (multimodal) — an image part in a user message. `source` mirrors the `ImageBlock` shape
 * (`{ type: "base64", media_type, data }`) so provider adapters serialize it to their own image format
 * (OpenAI/OpenRouter `image_url` with a data URL; Anthropic native base64 source).
 */
export interface LlmImagePart {
  type: "image";
  source: { type: "base64"; media_type: string; data: string } | { type: "url"; url: string };
}

export type LlmContentPart = LlmTextPart | LlmToolCallPart | LlmToolResultPart | LlmImagePart;

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

/**
 * T3.6 — `LlmRequest.responseFormat` opt-in for OpenAI native structured
 * outputs. When set, providers that support it emit the response strictly
 * matching the schema (no parse retries; lower latency than the
 * synthetic-tool fallback path).
 *
 * Two shapes:
 *  - `{ type: "json_schema", jsonSchema: { name, schema, strict? } }` —
 *    the canonical structured-outputs shape (`gpt-4o-2024-08-06+`).
 *    `strict` defaults to `true` (provider guarantees match).
 *  - `{ type: "json_object" }` — the legacy "JSON mode" hint (older
 *    OpenAI models). Returns JSON but does NOT guarantee schema match.
 *
 * Providers that don't support the field (Anthropic, Ollama) silently
 * ignore it at the wire layer (`buildAnthropicCommonBody`,
 * `buildOllamaChatBody`).
 */
export type LlmResponseFormat =
  | { type: "json_object" }
  | {
      type: "json_schema";
      jsonSchema: {
        name: string;
        schema: Record<string, unknown>;
        strict?: boolean;
      };
    };

export interface LlmRequest {
  model: string;
  system?: string | LlmSystemBlock[];
  messages: LlmMessage[];
  tools?: LlmTool[];
  maxTokens?: number;
  temperature?: number;
  /** T3.6 — opt into native structured outputs (OpenAI-compat providers). */
  responseFormat?: LlmResponseFormat;
  /**
   * Reasoning / extended-thinking request (issue #47). Derived from `ModelSelection.params` (the
   * `thinking` param). The wire encoding is provider-specific: OpenRouter (and OpenAI-compatible
   * passthroughs) use the unified `reasoning: { effort }` object; native OpenAI Chat Completions uses
   * the top-level `reasoning_effort` string (see `buildOpenAIBody`). The model streams reasoning back
   * as `delta.reasoning` (or `delta.reasoning_content` on some compat providers), surfaced as
   * `reasoning_delta` events. `effort` is required once the object is present — an empty object would
   * request nothing.
   */
  reasoning?: { effort: string };
  /**
   * Step-cap force-close: per-request tool gating. `"none"` tells the provider to emit no tool
   * calls even when `tools` are present (forcing a text answer); `"required"` forces a tool call;
   * `"auto"` (or omitted) is the default. Maps to OpenAI/OpenRouter `tool_choice`. The agent loop
   * sets `"none"` on a final/ceiling round so a cached agent (whose tools cannot be un-registered)
   * is still forced to produce a closing summary.
   */
  toolChoice?: "auto" | "none" | "required";
}

export type LlmEvent =
  | { type: "text_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
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
