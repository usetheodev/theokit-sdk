/**
 * AWS Bedrock client for Anthropic Messages (Adoption Roadmap #8; ADRs
 * D286-D302).
 *
 * v1: non-streaming only (`POST /model/{id}/invoke`). D302 defers
 * `/invoke-with-response-stream` (AWS Event Stream binary format) to v1.x.
 *
 * Body massage (D289):
 *  - inject `anthropic_version: "bedrock-2023-05-31"`
 *  - strip `model` from body (goes in URL)
 *  - strip `stream` from body (D302 — non-streaming only in v1)
 *
 * Uses native `fetch` only — no `@aws-sdk/client-bedrock-runtime`.
 *
 * @internal
 */

import { ConfigurationError } from "../../errors.js";
import { mapBedrockError } from "../errors/mappers/bedrock.js";
import {
  inferRegionFromModelId,
  resolveBedrockBaseUrl,
  stripBedrockPrefix,
} from "../providers/builtin/bedrock.js";
import { resolveBedrockToken } from "./bedrock-token-cache.js";
import { makeLlmFinish, parseToolArguments } from "./finish.js";
import type {
  LlmClient,
  LlmEvent,
  LlmFinish,
  LlmMessage,
  LlmRequest,
  LlmStopReason,
  LlmToolCallPart,
} from "./types.js";

export interface BedrockAnthropicClientOptions {
  /**
   * AWS Bearer token. When non-empty, used as-is. When empty/undefined,
   * resolved lazily per request via `resolveBedrockToken(region)` (D287).
   */
  apiKey?: string;
  /** Override the resolved baseUrl (rarely needed; defaults derive from model id). */
  baseUrl?: string;
  /** Injected fetch impl for tests. */
  fetch?: typeof fetch;
}

interface BedrockResponseBody {
  id?: string;
  type?: string;
  role?: string;
  content?: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  >;
  stop_reason?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export class BedrockAnthropicClient implements LlmClient {
  readonly name = "bedrock";
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: BedrockAnthropicClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async *stream(
    request: LlmRequest,
    signal: AbortSignal,
  ): AsyncGenerator<LlmEvent, LlmFinish, void> {
    const region = inferRegionFromModelId(request.model) ?? process.env.AWS_REGION ?? "us-east-1";
    // EC-6 absorbed: lazy token resolution with helpful error when missing.
    const token =
      this.options.apiKey !== undefined && this.options.apiKey.length > 0
        ? this.options.apiKey
        : await resolveBedrockToken(region);
    if (token === undefined || token.length === 0) {
      throw new ConfigurationError(
        "Bedrock requires AWS_BEARER_TOKEN_BEDROCK env var, or install " +
          "`@aws/bedrock-token-generator` for auto-refresh, or pass apiKey explicitly.",
        { code: "auth_failed" },
      );
    }

    const bareModel = stripBedrockPrefix(request.model);
    const baseUrl = this.options.baseUrl ?? resolveBedrockBaseUrl(request.model);
    const encodedModel = encodeURIComponent(bareModel);
    // D302 / EC-5: v1 always uses /invoke (non-streaming).
    const endpoint = `/model/${encodedModel}/invoke`;
    const url = `${baseUrl}${endpoint}`;

    const body = buildBedrockBody(request);

    const response = await this.fetchImpl(url, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // keep string
      }
      throw mapBedrockError({
        status: response.status,
        body: parsed,
        headers: response.headers,
        endpoint,
      });
    }

    const data = (await response.json()) as BedrockResponseBody;
    const text = (data.content ?? [])
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("");
    const toolCalls: LlmToolCallPart[] = (data.content ?? [])
      .filter(
        (c): c is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } =>
          c.type === "tool_use",
      )
      .map((c) => ({
        type: "tool_use" as const,
        id: c.id,
        name: c.name,
        input: parseToolArguments(JSON.stringify(c.input)),
      }));

    // Emit the entire text as a single delta to preserve the streaming interface.
    if (text.length > 0) yield { type: "text_delta", text };

    return makeLlmFinish({
      stopReason: mapStopReason(data.stop_reason ?? null),
      text,
      toolCalls,
      inputTokens: data.usage?.input_tokens,
      outputTokens: data.usage?.output_tokens,
    });
  }
}

function buildBedrockBody(request: LlmRequest): Record<string, unknown> {
  // D289: anthropic_version injected; model + stream stripped.
  const body: Record<string, unknown> = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: request.maxTokens ?? 4096,
    messages: request.messages.map(toBedrockMessage),
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

function toBedrockMessage(message: LlmMessage): Record<string, unknown> {
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
