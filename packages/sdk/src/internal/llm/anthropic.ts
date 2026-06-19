import { mapAnthropicError } from "../error-mappers/anthropic.js";
import { buildAnthropicCommonBody, mapAnthropicStopReason } from "./anthropic-shared.js";
import { makeLlmFinish, parseToolArguments } from "./finish.js";
import { parseSseStream } from "./sse.js";
import type {
  LlmClient,
  LlmEvent,
  LlmFinish,
  LlmRequest,
  LlmStopReason,
  LlmToolCallPart,
} from "./types.js";

/**
 * Real Anthropic Messages client. Streams `/v1/messages` and translates the
 * vendor SSE events (`content_block_delta`, `content_block_start`,
 * `message_delta`, `message_stop`) into our provider-agnostic `LlmEvent`s.
 *
 * Uses native `fetch` only — no `@anthropic-ai/sdk` dependency.
 *
 * @internal
 */

export interface AnthropicClientOptions {
  apiKey: string;
  baseUrl?: string;
  version?: string;
  fetch?: typeof fetch;
}

interface AnthropicTextDelta {
  type: "content_block_delta";
  delta: { type: "text_delta"; text: string };
}

interface AnthropicToolStart {
  type: "content_block_start";
  index: number;
  content_block: { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
}

interface AnthropicToolDelta {
  type: "content_block_delta";
  index: number;
  delta: { type: "input_json_delta"; partial_json: string };
}

interface AnthropicMessageDelta {
  type: "message_delta";
  delta: { stop_reason: string | null };
  /**
   * T3.8 — Anthropic native usage shape carries the 5-bucket cache counters
   * when the request annotated system blocks with `cache_control:
   * {type:"ephemeral"}` (shipped in T3.5). `cache_creation_input_tokens`
   * surfaces as `LlmFinish.cacheWriteTokens` (the 1.25x billing tier);
   * `cache_read_input_tokens` surfaces as `LlmFinish.cacheReadTokens` (the
   * 0.1x billing tier). Pre-T3.8 the SDK dropped both fields silently.
   */
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

type AnthropicEvent =
  | AnthropicTextDelta
  | AnthropicToolStart
  | AnthropicToolDelta
  | AnthropicMessageDelta
  | { type: "message_stop" }
  | { type: string };

export class AnthropicClient implements LlmClient {
  readonly name = "anthropic";
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: AnthropicClientOptions) {
    this.baseUrl = options.baseUrl ?? "https://api.anthropic.com";
    this.fetchImpl = options.fetch ?? fetch;
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: HTTP+SSE handshake + accumulator is intentionally one block
  async *stream(
    request: LlmRequest,
    signal: AbortSignal,
  ): AsyncGenerator<LlmEvent, LlmFinish, void> {
    const body = buildAnthropicBody(request);
    const response = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": this.options.apiKey,
        "anthropic-version": this.options.version ?? "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      // Parse body as JSON when possible — gives the mapper access to
      // `error.code` / `error.type` fields. Leave as string otherwise.
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // not JSON — keep as string
      }
      throw mapAnthropicError({
        status: response.status,
        body,
        headers: response.headers,
        endpoint: "/v1/messages",
      });
    }

    const accumulator = new AnthropicStreamAccumulator();
    for await (const record of parseSseStream(response.body, signal)) {
      if (record.event === "ping" || record.event === "message_start") continue;
      let parsed: AnthropicEvent;
      try {
        parsed = JSON.parse(record.data) as AnthropicEvent;
      } catch {
        continue;
      }
      const events = accumulator.consume(parsed);
      for (const event of events) yield event;
    }
    return accumulator.finish();
  }
}

class AnthropicStreamAccumulator {
  private text = "";
  private stopReason: LlmStopReason = "end_turn";
  private inputTokens?: number;
  private outputTokens?: number;
  private cacheReadTokens?: number;
  private cacheWriteTokens?: number;
  private readonly toolCalls = new Map<number, LlmToolCallPart>();
  private readonly toolBuffers = new Map<number, string>();

  consume(event: AnthropicEvent): LlmEvent[] {
    if (event.type === "content_block_start") {
      this.handleToolStart(event as AnthropicToolStart);
      return [];
    }
    if (event.type === "content_block_delta") {
      return this.handleContentDelta(event as AnthropicTextDelta | AnthropicToolDelta);
    }
    if (event.type === "message_delta") {
      this.handleMessageDelta(event as AnthropicMessageDelta);
    }
    return [];
  }

  private handleToolStart(start: AnthropicToolStart): void {
    if (start.content_block.type !== "tool_use") return;
    this.toolCalls.set(start.index, {
      type: "tool_use",
      id: start.content_block.id,
      name: start.content_block.name,
      input: { ...start.content_block.input },
    });
    this.toolBuffers.set(start.index, "");
  }

  private handleContentDelta(delta: AnthropicTextDelta | AnthropicToolDelta): LlmEvent[] {
    if (delta.delta.type === "text_delta") {
      const text = (delta as AnthropicTextDelta).delta.text;
      this.text += text;
      return [{ type: "text_delta", text }];
    }
    const idx = (delta as AnthropicToolDelta).index;
    const existing = this.toolBuffers.get(idx) ?? "";
    this.toolBuffers.set(idx, existing + (delta as AnthropicToolDelta).delta.partial_json);
    return [];
  }

  /**
   * T3.8 — extract token counters from Anthropic's `message_delta` usage.
   * Public on the class so the test seam can drive it directly without
   * spinning the SSE parser.
   */
  handleMessageDelta(md: AnthropicMessageDelta): void {
    this.stopReason = mapAnthropicStopReason(md.delta.stop_reason);
    if (md.usage?.input_tokens !== undefined) this.inputTokens = md.usage.input_tokens;
    if (md.usage?.output_tokens !== undefined) this.outputTokens = md.usage.output_tokens;
    // T3.8 — treat 0 as "no cache activity" and leave the bucket
    // unreported (mirrors usage-accumulator's filter where zero-value
    // entries are stripped from the emitted TokenUsage).
    if (
      md.usage?.cache_creation_input_tokens !== undefined &&
      md.usage.cache_creation_input_tokens > 0
    ) {
      this.cacheWriteTokens = md.usage.cache_creation_input_tokens;
    }
    if (md.usage?.cache_read_input_tokens !== undefined && md.usage.cache_read_input_tokens > 0) {
      this.cacheReadTokens = md.usage.cache_read_input_tokens;
    }
  }

  finish(): LlmFinish {
    const toolCalls: LlmToolCallPart[] = [];
    for (const [index, tool] of this.toolCalls.entries()) {
      const buffered = this.toolBuffers.get(index);
      const parsed = parseToolArguments(buffered);
      if (Object.keys(parsed).length > 0) tool.input = parsed;
      toolCalls.push(tool);
    }
    return makeLlmFinish({
      stopReason: this.stopReason,
      text: this.text,
      toolCalls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      // T3.8 — surface Anthropic native cache-token counters when the
      // request used `cache_control: {type:"ephemeral"}` on system blocks.
      cacheReadTokens: this.cacheReadTokens,
      cacheWriteTokens: this.cacheWriteTokens,
    });
  }
}

/**
 * T3.8 — test seam: exposes the AnthropicStreamAccumulator directly so
 * unit tests can drive the message_delta path without spinning the SSE
 * parser. `@internal` — not part of the public surface.
 */
export const __testing__AnthropicAccumulator = AnthropicStreamAccumulator;

function buildAnthropicBody(request: LlmRequest): Record<string, unknown> {
  return {
    model: request.model,
    stream: true,
    ...buildAnthropicCommonBody(request),
  };
}
