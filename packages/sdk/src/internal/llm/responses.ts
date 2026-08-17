/**
 * OpenAI **Responses API** transport (`apiMode: "responses_api"`).
 *
 * The SDK's `ApiMode` declared `"responses_api"` but shipped NO transport — `selectTransport` threw
 * `transport_unavailable` (whose message even names `@theokit-transport-responses_api`). This IS that
 * transport: an `LlmClient` that POSTs the Responses-API body to `${baseUrl}/responses` and translates the
 * SSE event stream into `LlmEvent`/`LlmFinish`. It powers the ChatGPT Codex backend
 * (`https://chatgpt.com/backend-api/codex/responses`) and any responses-API provider.
 *
 * The request-body shape and the SSE event names/fields follow the OpenAI Responses API wire protocol
 * (event names, field access, terminal/usage handling), implemented against theokit's
 * `LlmClient` contract (`name` + `stream → AsyncGenerator<LlmEvent, LlmFinish>`).
 *
 * `extraHeaders` (unused by the chat-completions transport until now) + `baseUrl` are consumed here; a `fetch`
 * override lets a host inject a refresh-aware fetch (dynamic `ChatGPT-Account-Id` / `session-id`, mid-turn
 * token refresh) — mirroring `OpenAIClient`.
 */
import { mapOpenAICompatibleError } from "../error-mappers/openai-compatible.js";
import { collapseSystemText, makeLlmFinish, parseToolArguments } from "./finish.js";
import { parseSseStream } from "./sse.js";
import { toStringToolResultContent } from "./tool-result-content.js";
import type {
  LlmClient,
  LlmEvent,
  LlmFinish,
  LlmMessage,
  LlmRequest,
  LlmStopReason,
  LlmToolCallPart,
} from "./types.js";

export interface ResponsesApiClientOptions {
  apiKey: string;
  /** e.g. `https://chatgpt.com/backend-api/codex`; the client POSTs `${baseUrl}/responses`. */
  baseUrl?: string;
  /** Static headers the profile declares (e.g. `ChatGPT-Account-Id`, `originator`). */
  extraHeaders?: Record<string, string>;
  /** Injected fetch (refresh-aware / dynamic headers). Defaults to global `fetch`. */
  fetch?: typeof fetch;
  providerName?: string;
}

/** Translate an `LlmMessage` into the Responses-API `input[]` items it contributes. */
// PRE-EXISTING debt, exposed when M75 fixed the Biome config that used to abort before
// sweeping these files (a nested root under refactor/). It is not new code and was not touched
// by M75; refactoring SDK internals without review would trade a visible problem for a diff
// risky. Tracked in usetheodev/theokit-sdk#151.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: see the reason just above
function messageToInputItems(message: LlmMessage): unknown[] {
  const items: unknown[] = [];
  if (message.role === "user") {
    const content: unknown[] = [];
    for (const part of message.content) {
      if (part.type === "text") {
        content.push({ type: "input_text", text: part.text });
      } else if (part.type === "image") {
        const url =
          part.source.type === "base64"
            ? `data:${part.source.media_type};base64,${part.source.data}`
            : part.source.url;
        content.push({ type: "input_image", image_url: url });
      } else if (part.type === "tool_result") {
        items.push({
          type: "function_call_output",
          call_id: part.toolUseId,
          output: toStringToolResultContent(part.content, "openai-responses"),
        });
      }
    }
    if (content.length > 0) items.push({ role: "user", content });
    return items;
  }
  if (message.role === "assistant") {
    const content: unknown[] = [];
    for (const part of message.content) {
      if (part.type === "text") {
        content.push({ type: "output_text", text: part.text });
      } else if (part.type === "tool_use") {
        items.push({
          type: "function_call",
          call_id: part.id,
          name: part.name,
          arguments: JSON.stringify(part.input),
        });
      }
    }
    if (content.length > 0) items.push({ role: "assistant", content });
    return items;
  }
  // system role rarely appears here (system travels on `request.system`); fold to text.
  const text = message.content
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n");
  if (text.length > 0) items.push({ role: "system", content: text });
  return items;
}

/** Build the Responses-API request body from an `LlmRequest`. */
export function buildResponsesBody(request: LlmRequest): Record<string, unknown> {
  const input: unknown[] = [];
  for (const message of request.messages) {
    for (const item of messageToInputItems(message)) input.push(item);
  }
  // The Responses API wants the BARE model id (`gpt-5.4`), never a `provider/model` id. The router
  // normally strips the provider prefix before the transport; strip here too as defense-in-depth so an
  // unstripped `openai-chatgpt/gpt-5.4` can never reach the backend as a 400 (decoupled from the router's
  // provider-inference heuristics).
  const slash = request.model.lastIndexOf("/");
  const model = slash >= 0 ? request.model.slice(slash + 1) : request.model;
  const body: Record<string, unknown> = { model, input, stream: true, store: false };
  const instructions = collapseSystemText(request.system);
  if (instructions.length > 0) body.instructions = instructions;
  if (request.maxTokens !== undefined) body.max_output_tokens = request.maxTokens;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  const tools = (request.tools ?? []).map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    strict: false,
  }));
  if (tools.length > 0) body.tools = tools;
  if (request.reasoning !== undefined) body.reasoning = { effort: request.reasoning.effort };
  return body;
}

interface ResponsesEvent {
  type?: string;
  delta?: string;
  item_id?: string;
  item?: {
    type?: string;
    id?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
  };
  response?: {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      output_tokens_details?: { reasoning_tokens?: number };
    };
    error?: { message?: string };
  };
  message?: string;
}

export class ResponsesApiClient implements LlmClient {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ResponsesApiClientOptions) {
    this.name = options.providerName ?? "openai-responses";
    this.baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? fetch;
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the SSE dispatch (text / reasoning / tool-call add+delta+done / terminal+usage / error) is one cohesive state machine, mirroring OpenAIStreamAccumulator.consume.
  async *stream(
    request: LlmRequest,
    signal: AbortSignal,
  ): AsyncGenerator<LlmEvent, LlmFinish, void> {
    const providerId = this.options.providerName ?? "openai";
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "text/event-stream",
      authorization: `Bearer ${this.options.apiKey}`,
      ...(this.options.extraHeaders ?? {}),
    };
    const url = `${this.baseUrl}/responses`;

    const response = await this.fetchImpl(url, {
      method: "POST",
      signal,
      headers,
      body: JSON.stringify(buildResponsesBody(request)),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        /* not JSON */
      }
      throw mapOpenAICompatibleError({
        providerId,
        status: response.status,
        body,
        headers: response.headers,
        endpoint: "/responses",
      });
    }

    let text = "";
    const toolCalls: LlmToolCallPart[] = [];
    let stopReason: LlmStopReason = "end_turn";
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let reasoningTokens: number | undefined;
    // function-call accumulation keyed by the streamed output-item id.
    const pending: Record<string, { callId: string; name: string; args: string }> = {};

    if (response.body !== null) {
      for await (const record of parseSseStream(response.body, signal)) {
        if (record.data === "[DONE]") break;
        let event: ResponsesEvent;
        try {
          event = JSON.parse(record.data) as ResponsesEvent;
        } catch {
          continue;
        }
        const t = event.type;
        if (t === "response.output_text.delta") {
          const d = event.delta ?? "";
          if (d.length > 0) {
            text += d;
            yield { type: "text_delta", text: d };
          }
        } else if (
          t === "response.reasoning_summary_text.delta" ||
          t === "response.reasoning_text.delta"
        ) {
          const d = event.delta ?? "";
          if (d.length > 0) yield { type: "reasoning_delta", text: d };
        } else if (t === "response.output_item.added" && event.item?.type === "function_call") {
          const id = event.item.id ?? event.item.call_id ?? "call-0";
          pending[id] = {
            callId: event.item.call_id ?? id,
            name: event.item.name ?? "",
            args: event.item.arguments ?? "",
          };
        } else if (t === "response.function_call_arguments.delta") {
          const c = event.item_id !== undefined ? pending[event.item_id] : undefined;
          if (c !== undefined) c.args += event.delta ?? "";
        } else if (t === "response.output_item.done" && event.item?.type === "function_call") {
          const id = event.item.id ?? event.item.call_id ?? "call-0";
          const c = pending[id] ?? {
            callId: event.item.call_id ?? id,
            name: event.item.name ?? "",
            args: event.item.arguments ?? "",
          };
          const rawArgs = event.item.arguments ?? c.args;
          const call: LlmToolCallPart = {
            type: "tool_use",
            id: c.callId,
            name: c.name.length > 0 ? c.name : (event.item.name ?? ""),
            input: parseToolArguments(rawArgs),
          };
          // theokit#144: the call is carried by `LlmFinish.toolCalls` below. It used to also be
          // yielded as a `tool_use` event that no consumer read — see the `LlmEvent` docblock for
          // why the live tool channel is `onDelta`, not this stream.
          toolCalls.push(call);
          delete pending[id];
        } else if (t === "response.completed" || t === "response.incomplete") {
          const usage = event.response?.usage;
          if (usage !== undefined) {
            inputTokens = usage.input_tokens;
            outputTokens = usage.output_tokens;
            reasoningTokens = usage.output_tokens_details?.reasoning_tokens;
          }
          stopReason = t === "response.incomplete" ? "max_tokens" : "end_turn";
        } else if (t === "response.failed" || t === "error") {
          // Never echo a raw provider body — report the message only. Map to a typed provider error.
          const msg = event.response?.error?.message ?? event.message ?? "responses stream failed";
          yield { type: "error", message: msg };
          throw mapOpenAICompatibleError({
            providerId,
            status: 502,
            body: { error: { message: msg } },
            headers: response.headers,
            endpoint: "/responses",
          });
        }
      }
    }

    if (toolCalls.length > 0 && stopReason === "end_turn") stopReason = "tool_use";
    // theokit#144: `stopReason` is returned on the finish value, not yielded as an event.
    return makeLlmFinish({
      stopReason,
      text,
      toolCalls,
      inputTokens,
      outputTokens,
      reasoningTokens,
    });
  }
}
