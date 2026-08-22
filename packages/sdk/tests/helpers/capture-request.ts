/**
 * Drives a resolved provider-chain client through one turn against a stubbed global `fetch`, and
 * reports what the transport actually put on the wire.
 *
 * Why this exists (B-028/B-029, generalised for B-098): the base-URL / organization / credential
 * overrides are applied when the transport is BUILT (`router.ts` sets `opts.baseUrl`,
 * `opts.organization`), and `LlmClient` exposes only `name` and `stream` — so nothing about the
 * resolved configuration is readable from the chain itself. Measured alternatives that do NOT work:
 * `selectTransport` is module-local and cannot be spied, and a namespace spy on `OpenAIClient`
 * records zero calls because the router holds a direct import binding.
 *
 * What the user configures IS observable at the request, which is the better oracle anyway. The
 * idiom — resolve the chain, drain the client, assert on what the fetch received — is the one
 * `tests/internal/llm/router-auth.test.ts:63` already uses.
 *
 * B-098 asked for this to be shared rather than copied a third time: it was duplicated in
 * `tests/internal/providers/ollama.test.ts` and `tests/internal/providers/sibling-profiles.test.ts`,
 * and the four cloud overrides would have been the third copy.
 */

import { vi } from "vitest";

import { type ProviderRouterOptions, resolveProviderChain } from "../../src/internal/llm/router.js";

/** What the stubbed `fetch` observed for the single request the drained turn issues. */
export interface CapturedRequest {
  /** Full request URL, so both the base URL and the endpoint path are assertable. */
  url: string;
  /** `authorization` header, normalised across the two header casings. */
  authorization: string;
  /** Every request header, lower-cased — for overrides that set a header rather than a URL. */
  headers: Record<string, string>;
  /** The transport class's own name (`"openai"`, `"anthropic"`, `"ollama"`). */
  name: string;
}

/** One clean chat-completions turn: a text delta, a stop, and the terminator. */
const CHAT_COMPLETIONS_SSE =
  'data: {"choices":[{"index":0,"delta":{"content":"hi"}}]}\n\n' +
  'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n' +
  "data: [DONE]\n\n";

/**
 * One clean `anthropic_messages` turn. The `message_delta` carrying a `stop_reason` is required —
 * without it `anthropic.ts` throws `stream_truncated` and the drain never returns.
 */
export const ANTHROPIC_MESSAGES_SSE =
  "event: message_start\ndata: {}\n\n" +
  "event: message_delta\n" +
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":1,"output_tokens":1}}\n\n' +
  'event: message_stop\ndata: {"type":"message_stop"}\n\n';

export async function captureRequest(
  router: ProviderRouterOptions,
  sse: string = CHAT_COMPLETIONS_SSE,
): Promise<CapturedRequest> {
  let url = "";
  let headers: Record<string, string> = {};
  vi.stubGlobal("fetch", (async (u: unknown, init?: { headers?: Record<string, string> }) => {
    url = String(u);
    headers = Object.fromEntries(
      Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]),
    );
    return new Response(sse, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }) as unknown as typeof fetch);
  try {
    const [client] = resolveProviderChain(router);
    if (client === undefined) {
      throw new Error(`no client resolved for primary="${router.primary}"`);
    }
    const gen = (
      client as unknown as { stream: (r: unknown, s: AbortSignal) => AsyncGenerator }
    ).stream(
      { model: "m", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
      new AbortController().signal,
    );
    let r = await gen.next();
    while (!r.done) r = await gen.next();
    return { url, authorization: headers.authorization ?? "", headers, name: client.name };
  } finally {
    vi.unstubAllGlobals();
  }
}
