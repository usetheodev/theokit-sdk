import { mapOllamaHttpError, mapOllamaTransportError } from "../error-mappers/ollama.js";
import { mapOpenAICompatibleError } from "../error-mappers/openai-compatible.js";
import { collapseSystemText, makeLlmFinish, parseToolArguments } from "./finish.js";
import { parseSseStream } from "./sse.js";
import type {
  LlmClient,
  LlmEvent,
  LlmFinish,
  LlmMessage,
  LlmRequest,
  LlmStopReason,
  LlmToolCallPart,
} from "./types.js";

/**
 * Real OpenAI Chat Completions client. Streams `/v1/chat/completions` and
 * translates delta chunks into our provider-agnostic `LlmEvent`s.
 *
 * Uses native `fetch` only — no `openai` SDK dependency.
 *
 * @internal
 */

export interface OpenAIClientOptions {
  apiKey: string;
  baseUrl?: string;
  organization?: string;
  fetch?: typeof fetch;
  /**
   * Provider name for error mapping dispatch (T1.1, ADR D185). When set
   * to `"ollama"`, transport and HTTP errors go through `mapOllamaTransportError`
   * / `mapOllamaHttpError` for actionable messages before falling back to
   * the generic OpenAI-compatible mapper. Default `"openai"`.
   */
  providerName?: string;
}

interface OpenAIDeltaChunk {
  choices?: Array<{
    index: number;
    delta?: {
      content?: string;
      /** OpenRouter unified reasoning delta (issue #47) — streamed separately from `content`. */
      reasoning?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    /**
     * OpenAI + OpenRouter extended usage (D376). Anthropic prompt caching
     * surfaces as `prompt_tokens_details.cached_tokens` on OpenRouter passthrough;
     * native OpenAI exposes the same field on `chatcmpl-*` responses.
     */
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
    /** Anthropic-on-OpenRouter passes cache_creation_tokens top-level (cline#10266). */
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export class OpenAIClient implements LlmClient {
  readonly name = "openai";
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAIClientOptions) {
    this.baseUrl = options.baseUrl ?? "https://api.openai.com";
    this.fetchImpl = options.fetch ?? fetch;
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: HTTP+SSE handshake + accumulator is intentionally one block
  async *stream(
    request: LlmRequest,
    signal: AbortSignal,
  ): AsyncGenerator<LlmEvent, LlmFinish, void> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${this.options.apiKey}`,
    };
    if (this.options.organization !== undefined) {
      headers["openai-organization"] = this.options.organization;
    }
    const providerId = this.options.providerName ?? this.name;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        signal,
        headers,
        body: JSON.stringify(buildOpenAIBody(request)),
      });
    } catch (fetchErr) {
      // T1.1: Ollama-specific transport error mapping (ECONNREFUSED / ENOTFOUND).
      const mapped = mapOllamaTransportError({
        providerId,
        cause: fetchErr,
        endpoint: "/v1/chat/completions",
      });
      if (mapped !== undefined) throw mapped;
      throw fetchErr;
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // not JSON — keep as string for mapper raw field
      }
      // T1.1: try Ollama-specific HTTP mapper first; falls through to generic.
      const ollamaMapped = mapOllamaHttpError({
        providerId,
        status: response.status,
        body,
        headers: response.headers,
        endpoint: "/v1/chat/completions",
      });
      if (ollamaMapped !== undefined) throw ollamaMapped;
      // Use the openai-compatible mapper. For OpenAI proper the providerId
      // is "openai"; OpenRouter is handled in its own client subclass (see
      // OpenRouterClient if/when added). Providers tagged differently via
      // wrapper clients can pass their own providerId by overriding.
      throw mapOpenAICompatibleError({
        providerId,
        status: response.status,
        body,
        headers: response.headers,
        endpoint: "/v1/chat/completions",
      });
    }

    const accumulator = new OpenAIStreamAccumulator();
    for await (const record of parseSseStream(response.body, signal)) {
      if (record.data === "[DONE]") break;
      let chunk: OpenAIDeltaChunk;
      try {
        chunk = JSON.parse(record.data) as OpenAIDeltaChunk;
      } catch {
        continue;
      }
      const events = accumulator.consume(chunk);
      for (const event of events) yield event;
    }
    return accumulator.finish();
  }
}

class OpenAIStreamAccumulator {
  private text = "";
  private stopReason: LlmStopReason = "end_turn";
  private inputTokens?: number;
  private outputTokens?: number;
  private cacheReadTokens?: number;
  private cacheWriteTokens?: number;
  private reasoningTokens?: number;
  private readonly toolCalls = new Map<number, { id: string; name: string; args: string }>();

  consume(chunk: OpenAIDeltaChunk): LlmEvent[] {
    const events: LlmEvent[] = [];
    this.applyUsage(chunk.usage);
    for (const choice of chunk.choices ?? []) {
      // issue #47: reasoning delta (OpenRouter) precedes the visible text in arrival order.
      const reasoningEvent = this.applyReasoningDelta(choice.delta?.reasoning);
      if (reasoningEvent !== undefined) events.push(reasoningEvent);
      const textEvent = this.applyContentDelta(choice.delta?.content);
      if (textEvent !== undefined) events.push(textEvent);
      this.mergeToolCallDeltas(choice.delta?.tool_calls);
      this.applyFinishReason(choice.finish_reason);
    }
    return events;
  }

  private applyReasoningDelta(reasoning: string | undefined): LlmEvent | undefined {
    // issue #47: reasoning is NOT accumulated into `this.text` (the visible answer) — it is a
    // separate channel surfaced as `reasoning_delta` (→ thinking events at the loop layer).
    if (typeof reasoning !== "string" || reasoning.length === 0) return undefined;
    return { type: "reasoning_delta", text: reasoning };
  }

  private applyUsage(usage: OpenAIDeltaChunk["usage"]): void {
    if (usage?.prompt_tokens !== undefined) this.inputTokens = usage.prompt_tokens;
    if (usage?.completion_tokens !== undefined) this.outputTokens = usage.completion_tokens;
    // D376: cache + reasoning buckets via OpenRouter passthrough + OpenAI native.
    const cachedDetail = usage?.prompt_tokens_details?.cached_tokens;
    if (cachedDetail !== undefined) this.cacheReadTokens = cachedDetail;
    const reasoningDetail = usage?.completion_tokens_details?.reasoning_tokens;
    if (reasoningDetail !== undefined) this.reasoningTokens = reasoningDetail;
    // cline#10266 top-level fallback for Anthropic-on-OpenRouter.
    if (usage?.cache_read_input_tokens !== undefined) {
      this.cacheReadTokens = usage.cache_read_input_tokens;
    }
    if (usage?.cache_creation_input_tokens !== undefined) {
      this.cacheWriteTokens = usage.cache_creation_input_tokens;
    }
  }

  private applyContentDelta(content: string | undefined): LlmEvent | undefined {
    if (typeof content !== "string" || content.length === 0) return undefined;
    this.text += content;
    return { type: "text_delta", text: content };
  }

  private mergeToolCallDeltas(
    deltas: NonNullable<NonNullable<OpenAIDeltaChunk["choices"]>[number]["delta"]>["tool_calls"],
  ): void {
    for (const call of deltas ?? []) {
      const existing = this.toolCalls.get(call.index) ?? { id: "", name: "", args: "" };
      if (call.id !== undefined) existing.id = call.id;
      if (call.function?.name !== undefined) existing.name = call.function.name;
      if (call.function?.arguments !== undefined) existing.args += call.function.arguments;
      this.toolCalls.set(call.index, existing);
    }
  }

  private applyFinishReason(reason: string | null | undefined): void {
    if (reason === undefined || reason === null) return;
    this.stopReason = mapOpenAIFinish(reason);
  }

  finish(): LlmFinish {
    const toolCalls: LlmToolCallPart[] = [];
    for (const call of this.toolCalls.values()) {
      const input = parseToolArguments(call.args);
      toolCalls.push({ type: "tool_use", id: call.id, name: call.name, input });
    }
    return makeLlmFinish({
      stopReason: this.stopReason,
      text: this.text,
      toolCalls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheReadTokens: this.cacheReadTokens,
      cacheWriteTokens: this.cacheWriteTokens,
      reasoningTokens: this.reasoningTokens,
    });
  }
}

function mapOpenAIFinish(reason: string): LlmStopReason {
  switch (reason) {
    case "tool_calls":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "stop":
      return "end_turn";
    default:
      return "end_turn";
  }
}

function buildOpenAIBody(request: LlmRequest): Record<string, unknown> {
  const messages: Array<Record<string, unknown>> = [];
  const systemText = openAISystemText(request.system);
  if (systemText.length > 0) {
    messages.push({ role: "system", content: systemText });
  }
  for (const message of request.messages) {
    for (const out of toOpenAIMessages(message)) messages.push(out);
  }
  const body: Record<string, unknown> = {
    model: request.model,
    stream: true,
    // D376: opt-in to OpenAI's final-chunk usage record (no-op for providers
    // that don't honor it; OpenRouter / OpenAI both respect it).
    stream_options: { include_usage: true },
    messages,
  };
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  // issue #47: OpenRouter unified reasoning request — only when an effort was requested.
  if (request.reasoning?.effort !== undefined)
    body.reasoning = { effort: request.reasoning.effort };
  if (request.tools !== undefined && request.tools.length > 0) {
    body.tools = request.tools.map((tool) => ({
      type: "function",
      function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
    }));
  }
  const responseFormat = encodeOpenAIResponseFormat(request.responseFormat);
  if (responseFormat !== undefined) body.response_format = responseFormat;
  return body;
}

/**
 * T3.5 follow-up — collapse `LlmRequest.system` to the OpenAI wire shape
 * (single string).
 *
 * @internal
 */
const openAISystemText = collapseSystemText;

/**
 * T3.6 — encode `LlmResponseFormat` into the OpenAI wire shape. The
 * structured-outputs path defaults `strict` to `true` (provider guarantees
 * the response matches the schema).
 *
 * @internal
 */
function encodeOpenAIResponseFormat(
  rf: LlmRequest["responseFormat"],
): Record<string, unknown> | undefined {
  if (rf === undefined) return undefined;
  if (rf.type === "json_object") return { type: "json_object" };
  return {
    type: "json_schema",
    json_schema: {
      name: rf.jsonSchema.name,
      schema: rf.jsonSchema.schema,
      strict: rf.jsonSchema.strict ?? true,
    },
  };
}

/**
 * T3.6 — public test seam for `buildOpenAIBody`. The implementation is
 * file-local; the seam lets unit tests verify the wire shape without
 * exercising the streaming path.
 *
 * @internal
 */
export const __testing__buildOpenAIBody = buildOpenAIBody;
/** issue #47 test seam — exercise reasoning-delta parsing without a live stream. */
export const __testing__OpenAIStreamAccumulator = OpenAIStreamAccumulator;

function toOpenAIMessages(message: LlmMessage): Array<Record<string, unknown>> {
  if (message.role === "system") return [systemMessage(message)];
  if (message.role === "user") return userOrToolMessages(message);
  return [assistantMessage(message)];
}

function systemMessage(message: LlmMessage): Record<string, unknown> {
  return { role: "system", content: joinTextParts(message) };
}

function joinTextParts(message: LlmMessage): string {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => (part as { text: string }).text)
    .join("\n");
}

/**
 * Translate a logical `user` turn. If the turn contains tool_result parts
 * they must be emitted as `role: "tool"` messages with matching
 * `tool_call_id` — OpenAI rejects tool_calls followed by a user message.
 * Plain text parts (and any other parts) collapse into a single user
 * message that follows the tool messages.
 */
function userOrToolMessages(message: LlmMessage): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const part of message.content) {
    if (part.type === "tool_result") {
      out.push({
        role: "tool",
        tool_call_id: part.toolUseId,
        content: part.content,
      });
    }
  }
  const userText = joinTextParts(message);
  if (userText.length > 0) out.push({ role: "user", content: userText });
  return out;
}

function assistantMessage(message: LlmMessage): Record<string, unknown> {
  const text = joinTextParts(message);
  const toolCalls = message.content
    .filter((part) => part.type === "tool_use")
    .map((part) => {
      const tc = part as { id: string; name: string; input: Record<string, unknown> };
      return {
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.input) },
      };
    });
  const result: Record<string, unknown> = { role: "assistant", content: text };
  if (toolCalls.length > 0) result.tool_calls = toolCalls;
  return result;
}
