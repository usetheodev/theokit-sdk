/**
 * TheoKitClient — browser-safe client for consuming server adapter endpoints
 * (T20.2, ADR D454).
 *
 * Zero Node dependencies. Uses native fetch + manual SSE parsing.
 * Consumes the same HTTP contract as server adapters (POST /send, GET /stream).
 *
 * @public
 * @deprecated since 2.x — consumes a legacy server-adapter HTTP contract
 * (`POST /agent/send`, `GET /agent/stream`) that the ecosystem no longer
 * produces. For in-process agent runs use the `Agent` façade (`@theokit/sdk`);
 * for HTTP, the framework (`theokit`) exposes agents at `POST /api/agents/<name>`
 * over a `UIMessageStream` with its own typed client. The `@theokit/sdk/client`
 * sub-path will be removed in the next major.
 */

import type { ClientOptions, SendResponse, StreamEvent } from "./types.js";

/**
 * Browser-safe client for the legacy agent HTTP contract: `POST <basePath>/send`
 * and `GET <basePath>/stream`. Uses only `fetch` and `TextDecoder`, so it runs in
 * a browser, a worker, or Node with no Node-only dependency.
 *
 *   const client = new TheoKitClient({ baseUrl: "https://api.example.com" });
 *   const res = await client.send("hello");
 *   for await (const ev of client.stream("hello")) console.log(ev.type);
 *
 * Deprecated together with the `@theokit/sdk/client` sub-path — the module note
 * above names the replacements.
 *
 * Needs a reachable `baseUrl` (a trailing `/` is stripped) and a server exposing
 * BOTH routes under `basePath` (default `/agent`). `opts.headers` is merged into
 * every request and is the only auth affordance; there is no retry, no timeout and
 * no way to pass an `AbortSignal` — neither method accepts one.
 *
 * How it fails: both methods throw a plain `Error` on any non-2xx
 * (`TheoKitClient: send failed with status <n>` /
 * `TheoKitClient: stream failed with status <n>`), so the server's error body is
 * discarded. `stream` additionally throws
 * `TheoKitClient: response body is not readable` when the response carries no
 * body. There is no typed error class and no status field to branch on.
 *
 * Traps:
 *  - `stream` ends on a `data: [DONE]` sentinel. NOTHING in this package emits SSE
 *    framing: `createAgentHandler` returns a raw `AsyncIterable` and leaves
 *    `data: ` / `[DONE]` to the host. Pointed at this SDK's own adapter as-is, the
 *    generator yields no events and ends only when the socket closes.
 *  - A `data:` line whose payload is not JSON is skipped SILENTLY, so malformed
 *    output looks like a quiet stream rather than an error.
 *  - Leaving the loop early (`break`) releases the reader lock but does NOT abort
 *    the request; the connection stays open until the server closes it.
 *  - `stream` puts the whole input in the query string, so a long prompt can
 *    exceed a proxy's URL length limit while the same input works via `send`.
 */
export class TheoKitClient {
  private readonly _baseUrl: string;
  private readonly _basePath: string;
  private readonly _headers: Record<string, string>;

  constructor(opts: ClientOptions) {
    this._baseUrl = opts.baseUrl.replace(/\/$/, "");
    this._basePath = opts.basePath ?? "/agent";
    this._headers = opts.headers ?? {};
  }

  async send(input: string): Promise<SendResponse> {
    const url = `${this._baseUrl}${this._basePath}/send`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this._headers,
      },
      body: JSON.stringify({ input }),
    });

    if (!response.ok) {
      throw new Error(`TheoKitClient: send failed with status ${response.status}`);
    }

    return (await response.json()) as SendResponse;
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: SSE stream parsing with fetch + ReadableStream reader requires sequential control flow
  async *stream(input: string): AsyncGenerator<StreamEvent, void, void> {
    const url = `${this._baseUrl}${this._basePath}/stream?input=${encodeURIComponent(input)}`;
    const response = await fetch(url, {
      headers: {
        Accept: "text/event-stream",
        ...this._headers,
      },
    });

    if (!response.ok) {
      throw new Error(`TheoKitClient: stream failed with status ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("TheoKitClient: response body is not readable");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      // jscpd:ignore-start — SSE stream buffer pattern (different protocol from NDJSON in ollama-native)
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        // jscpd:ignore-end

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data: ")) {
            const data = trimmed.slice(6);
            if (data === "[DONE]") return;
            try {
              yield JSON.parse(data) as StreamEvent;
            } catch {
              // Skip malformed SSE data lines
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
