import { mapAnthropicError } from "../errors/mappers/anthropic.js";
import { makeLlmFinish, parseToolArguments } from "./finish.js";
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
  usage?: { input_tokens?: number; output_tokens?: number };
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

  private handleMessageDelta(md: AnthropicMessageDelta): void {
    this.stopReason = mapStopReason(md.delta.stop_reason);
    if (md.usage?.input_tokens !== undefined) this.inputTokens = md.usage.input_tokens;
    if (md.usage?.output_tokens !== undefined) this.outputTokens = md.usage.output_tokens;
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
    });
  }
}

function mapStopReason(reason: string | null): LlmStopReason {
  switch (reason) {
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "stop_sequence":
      return "stop_sequence";
    case "end_turn":
    case null:
      return "end_turn";
    default:
      return "end_turn";
  }
}

function buildAnthropicBody(request: LlmRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    max_tokens: request.maxTokens ?? 4096,
    stream: true,
    messages: request.messages.map(toAnthropicMessage),
  };
  if (request.system !== undefined) body.system = request.system;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.tools !== undefined && request.tools.length > 0) {
    body.tools = request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
  }
  return body;
}

function toAnthropicMessage(message: LlmMessage): Record<string, unknown> {
  const role = message.role === "system" ? "user" : message.role;
  const content = message.content.map((part) => {
    if (part.type === "text") return { type: "text", text: part.text };
    if (part.type === "tool_use") {
      return { type: "tool_use", id: part.id, name: part.name, input: part.input };
    }
    return {
      type: "tool_result",
      tool_use_id: part.toolUseId,
      content: part.content,
      ...(part.isError === true ? { is_error: true } : {}),
    };
  });
  return { role, content };
}
