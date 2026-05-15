import { NetworkError } from "../../errors.js";
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
}

interface OpenAIDeltaChunk {
  choices?: Array<{
    index: number;
    delta?: {
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class OpenAIClient implements LlmClient {
  readonly name = "openai";
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAIClientOptions) {
    this.baseUrl = options.baseUrl ?? "https://api.openai.com";
    this.fetchImpl = options.fetch ?? fetch;
  }

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
    const response = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      signal,
      headers,
      body: JSON.stringify(buildOpenAIBody(request)),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new NetworkError(
        `OpenAI /v1/chat/completions returned ${response.status}: ${text.slice(0, 200)}`,
        { code: "openai_http_error" },
      );
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
  private readonly toolCalls = new Map<number, { id: string; name: string; args: string }>();

  consume(chunk: OpenAIDeltaChunk): LlmEvent[] {
    const events: LlmEvent[] = [];
    this.applyUsage(chunk.usage);
    for (const choice of chunk.choices ?? []) {
      const textEvent = this.applyContentDelta(choice.delta?.content);
      if (textEvent !== undefined) events.push(textEvent);
      this.mergeToolCallDeltas(choice.delta?.tool_calls);
      this.applyFinishReason(choice.finish_reason);
    }
    return events;
  }

  private applyUsage(usage: OpenAIDeltaChunk["usage"]): void {
    if (usage?.prompt_tokens !== undefined) this.inputTokens = usage.prompt_tokens;
    if (usage?.completion_tokens !== undefined) this.outputTokens = usage.completion_tokens;
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
  if (request.system !== undefined) messages.push({ role: "system", content: request.system });
  for (const message of request.messages) {
    for (const out of toOpenAIMessages(message)) messages.push(out);
  }
  const body: Record<string, unknown> = {
    model: request.model,
    stream: true,
    messages,
  };
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.tools !== undefined && request.tools.length > 0) {
    body.tools = request.tools.map((tool) => ({
      type: "function",
      function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
    }));
  }
  return body;
}

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
