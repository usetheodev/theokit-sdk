/**
 * `web_fetch` — built-in tool for coding agents.
 *
 * Fetches a URL via native `fetch()`. Rejects non-http(s) protocols.
 * Size-capped at 1 MB response body.
 *
 * Return shape (always a JSON string):
 *   - `{ ok: true, content, status_code, content_type }`
 *   - `{ ok: false, error: 'invalid_url' | 'fetch_failed' |
 *        'timeout' | 'too_large' | 'ssrf_blocked' | 'redirect_blocked' }`
 */

import type { CustomTool } from "@theokit/sdk";

import { Tool } from "@theokit/sdk";
import { z } from "zod";

import {
  RedirectBlockedError,
  type ScreenedFetchOptions,
  SsrfBlockedError,
  screenedFetch,
} from "./internal/network-guard.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MB

export interface CreateWebFetchToolOptions {
  /** M76 — name exposed to the model. Omitted => today's literal (additive). The name is a contract:
   *  the approval key, what the model sees and what telemetry records. */
  name?: string;
  /** M76 — description exposed to the model. Omitted => today's literal (additive). */
  description?: string;
  /** Default timeout in ms. */
  defaultTimeoutMs?: number;
  /**
   * Opt out of the SSRF guard (default `false`). When `true`, requests to
   * private/loopback/link-local/metadata addresses are NOT blocked — use only for
   * trusted local-dev tooling.
   */
  allowPrivateHosts?: boolean;
  /**
   * Max redirect hops to follow (each SSRF-screened). Default 5. Set `0` to BLOCK ALL
   * redirects — a 3xx then returns `{ ok: false, error: "redirect_blocked" }` (a strict
   * no-redirect policy for untrusted, model-chosen URLs).
   */
  maxRedirects?: number;
  /** Fetch implementation (injectable for tests — drive paths with no real network). */
  fetchImpl?: ScreenedFetchOptions["fetchImpl"];
  /** DNS resolver (injectable for tests — drive the SSRF path with no real DNS). */
  lookup?: ScreenedFetchOptions["lookup"];
}

/**
 * Build the `web_fetch` tool: retrieve one URL over HTTP or HTTPS and hand the model the body as
 * text. Every option is optional — `createWebFetchTool()` gives an SSRF-guarded fetch with a
 * 30-second timeout.
 *
 * The body is decoded as UTF-8 whatever the content type says, so a PDF or an image comes back as
 * mojibake rather than an error: check `content_type` before trusting `content`. The 1 MB body cap is
 * fixed rather than an option, and is enforced twice — against `content-length` when the server sends
 * one, then against the bytes actually downloaded.
 *
 * The SSRF guard screens the resolved ADDRESS rather than the hostname, and screens every redirect
 * hop again. `maxRedirects: 0` refuses any 3xx outright with `redirect_blocked`, which is the strict
 * setting for a URL the model chose itself. `allowPrivateHosts: true` disables the guard entirely,
 * and with a model-supplied URL that is enough to reach a cloud metadata endpoint — it is for local
 * development against your own services, not for production.
 *
 * Refusals: `invalid_url` (unparseable, or a scheme other than http/https), `ssrf_blocked`,
 * `redirect_blocked`, `too_large`, `timeout`, `fetch_failed`. A 4xx or 5xx is NOT a refusal — it
 * returns `ok: true` with the body and `status_code`, so check the status.
 */
export function createWebFetchTool(opts?: CreateWebFetchToolOptions): CustomTool {
  const defaultTimeoutMs = opts?.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const allowPrivateHosts = opts?.allowPrivateHosts ?? false;
  const maxRedirects = opts?.maxRedirects;
  const fetchImpl = opts?.fetchImpl;
  const lookup = opts?.lookup;

  return Tool.create({
    name: opts?.name ?? "web_fetch",
    description:
      opts?.description ??
      "Fetch the contents of a URL via HTTP/HTTPS. Use only for URLs the user provided or that you " +
        "are confident help with the task; never invent or guess URLs. Rejects non-http(s) URLs and " +
        "is SSRF-guarded by default (private/loopback/link-local/cloud-metadata hosts are refused " +
        "with an ssrf_blocked error). The response body is capped at 1 MB. Returns " +
        "{ ok, content, status_code, content_type } or { ok: false, error }.",
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
        const response = await screenedFetch(url, {
          signal: controller.signal,
          allowPrivateHosts,
          ...(maxRedirects !== undefined ? { maxRedirects } : {}),
          ...(fetchImpl ? { fetchImpl } : {}),
          ...(lookup ? { lookup } : {}),
        });
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
        if (err instanceof RedirectBlockedError) {
          return JSON.stringify({ ok: false, error: "redirect_blocked", url, reason: err.message });
        }
        if (err instanceof SsrfBlockedError) {
          return JSON.stringify({ ok: false, error: "ssrf_blocked", url, reason: err.message });
        }
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
