/**
 * GCP Vertex AI client for Anthropic Messages (Adoption Roadmap #8; ADRs
 * D292, D293).
 *
 * v1 uses `:rawPredict` (non-streaming). Streaming via `:streamRawPredict`
 * with SSE follows the same shape but is gated behind a future iteration —
 * v1 returns the full response as a single delta to keep the streaming
 * interface contract.
 *
 * Body massage (D292):
 *  - inject `anthropic_version: "vertex-2023-10-16"`
 *  - strip `model` from body (goes in URL)
 *  - strip `stream` from body
 *
 * Uses native `fetch` only — no `@anthropic-ai/vertex-sdk` (D294).
 *
 * @internal
 */

import { ConfigurationError } from "../../errors.js";
import { mapVertexError } from "../errors/mappers/vertex.js";
import {
  resolveVertexBaseUrl,
  stripVertexPrefix,
} from "../providers/builtin/vertex.js";
import { makeLlmFinish, parseToolArguments } from "./finish.js";
import {
  resolveVertexAccessToken,
  resolveVertexLocation,
  resolveVertexProjectId,
} from "./vertex-auth.js";
import type {
  LlmClient,
  LlmEvent,
  LlmFinish,
  LlmMessage,
  LlmRequest,
  LlmStopReason,
  LlmToolCallPart,
} from "./types.js";

export interface VertexAnthropicClientOptions {
  /** When undefined, resolved lazily via `resolveVertexProjectId()`. */
  projectId?: string;
  /** When undefined, resolved lazily via `resolveVertexLocation()`. */
  location?: string;
  /**
   * OAuth access token. When provided, used as-is. When empty/undefined,
   * resolved lazily per request via `resolveVertexAccessToken()` (D288).
   */
  apiKey?: string;
  fetch?: typeof fetch;
}

interface VertexAnthropicResponse {
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

export class VertexAnthropicClient implements LlmClient {
  readonly name = "vertex_anthropic";
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: VertexAnthropicClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async *stream(
    request: LlmRequest,
    signal: AbortSignal,
  ): AsyncGenerator<LlmEvent, LlmFinish, void> {
    // EC-1 absorbed: lazy projectId + token resolution with helpful errors.
    const projectId = this.options.projectId ?? resolveVertexProjectId();
    if (projectId === undefined) {
      throw new ConfigurationError(
        "Vertex requires a project id. Set GOOGLE_CLOUD_PROJECT env var or run " +
          "`gcloud config set project <id>`.",
        { code: "auth_failed" },
      );
    }
    const location = this.options.location ?? resolveVertexLocation();
    const accessToken =
      this.options.apiKey !== undefined && this.options.apiKey.length > 0
        ? this.options.apiKey
        : await resolveVertexAccessToken();
    if (accessToken === undefined || accessToken.length === 0) {
      throw new ConfigurationError(
        "Vertex could not resolve an access token. Run " +
          "`gcloud auth application-default login` or set " +
          "GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON path.",
        { code: "auth_failed" },
      );
    }
    const baseUrl = resolveVertexBaseUrl({
      projectId,
      location,
      modelDialect: "anthropic",
    });
    const bareModel = stripVertexPrefix(request.model);
    // D292: v1 uses :rawPredict (non-streaming). The streaming interface
    // is preserved by emitting the full response as a single delta below.
    const endpoint = `/models/${encodeURIComponent(bareModel)}:rawPredict`;
    const url = `${baseUrl}${endpoint}`;

    const body = buildVertexAnthropicBody(request);

    const response = await this.fetchImpl(url, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
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
      throw mapVertexError({
        status: response.status,
        body: parsed,
        headers: response.headers,
        endpoint,
      });
    }

    const data = (await response.json()) as VertexAnthropicResponse;
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

function buildVertexAnthropicBody(request: LlmRequest): Record<string, unknown> {
  // D292: anthropic_version is REQUIRED in body (not header) and `model` is stripped.
  const body: Record<string, unknown> = {
    anthropic_version: "vertex-2023-10-16",
    max_tokens: request.maxTokens ?? 4096,
    messages: request.messages.map(toVertexMessage),
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

function toVertexMessage(message: LlmMessage): Record<string, unknown> {
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
