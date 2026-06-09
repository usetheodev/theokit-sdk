/**
 * TheoKitClient — browser-safe client for consuming server adapter endpoints
 * (T20.2, ADR D454).
 *
 * Zero Node dependencies. Uses native fetch + manual SSE parsing.
 * Consumes the same HTTP contract as server adapters (POST /send, GET /stream).
 *
 * @public
 */

import type { ClientOptions, SendResponse, StreamEvent } from "./types.js";

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
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

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
