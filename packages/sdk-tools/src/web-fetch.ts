/**
 * `web_fetch` — built-in tool for coding agents.
 *
 * Fetches a URL via native `fetch()`. Rejects non-http(s) protocols.
 * Size-capped at 1 MB response body.
 *
 * Return shape (always a JSON string):
 *   - `{ ok: true, content, status_code, content_type }`
 *   - `{ ok: false, error: 'invalid_url' | 'fetch_failed' |
 *        'timeout' | 'too_large' }`
 */

import type { CustomTool } from "@theokit/sdk";

import { defineTool } from "@theokit/sdk";
import { z } from "zod";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MB

export interface CreateWebFetchToolOptions {
  /** Default timeout in ms. */
  defaultTimeoutMs?: number;
}

export function createWebFetchTool(opts?: CreateWebFetchToolOptions): CustomTool {
  const defaultTimeoutMs = opts?.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;

  return defineTool({
    name: "web_fetch",
    description:
      "Fetch content from a URL via HTTP/HTTPS. Rejects non-http(s) URLs. " +
      "Response body capped at 1 MB. Returns { ok, content, status_code } " +
      "or { ok: false, error }.",
    inputSchema: z.object({
      url: z.string().min(1).describe("URL to fetch (http or https only)."),
      timeout_ms: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Timeout in milliseconds (default 30000)."),
    }),
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: fetch with guards
    handler: async ({ url, timeout_ms }) => {
      // Validate protocol
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return JSON.stringify({ ok: false, error: "invalid_url", url });
      }

      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return JSON.stringify({
          ok: false,
          error: "invalid_url",
          url,
          detail: "only http and https protocols allowed",
        });
      }

      const timeoutMs = timeout_ms ?? defaultTimeoutMs;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);

        // Check content-length header before downloading
        const contentLength = response.headers.get("content-length");
        if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
          return JSON.stringify({
            ok: false,
            error: "too_large",
            url,
            size: Number(contentLength),
            limit: MAX_BODY_BYTES,
          });
        }

        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > MAX_BODY_BYTES) {
          return JSON.stringify({
            ok: false,
            error: "too_large",
            url,
            size: buffer.byteLength,
            limit: MAX_BODY_BYTES,
          });
        }

        const content = new TextDecoder("utf-8").decode(buffer);
        const contentType = response.headers.get("content-type") ?? undefined;

        return JSON.stringify({
          ok: true,
          content,
          status_code: response.status,
          content_type: contentType,
        });
      } catch (err) {
        clearTimeout(timer);
        const e = err as { name?: string; message?: string };
        if (e.name === "AbortError") {
          return JSON.stringify({ ok: false, error: "timeout", url, timeout_ms: timeoutMs });
        }
        return JSON.stringify({
          ok: false,
          error: "fetch_failed",
          url,
          message: e.message ?? "unknown",
        });
      }
    },
  });
}
