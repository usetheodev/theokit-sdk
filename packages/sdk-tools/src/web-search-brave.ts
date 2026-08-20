/**
 * Brave Search adapter for `createWebSearchTool` (M3-7).
 *
 * `createBraveWebSearchAdapter()` returns a `WebSearchCallback` that queries the
 * Brave Search API using an env-driven key (`BRAVE_API_KEY`). It plugs into the
 * provider-agnostic `createWebSearchTool` via its callback seam — the tool is NOT
 * modified. The `fetch` impl is injectable (default `globalThis.fetch`) so the
 * adapter is offline-testable; a plain fetch (not `screenedFetch`) is used because
 * the endpoint host is fixed (no SSRF surface) and `screenedFetch` cannot carry
 * the required auth header. Zero new dependencies. Design: blueprint m3-websearch-adapter.
 */

import { ConfigurationError } from "@theokit/sdk";

import type { WebSearchCallback, WebSearchResult } from "./web-search.js";

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Options for {@link createBraveWebSearchAdapter}. `apiKey` falls back to `BRAVE_API_KEY` and
 * `endpoint` to Brave's public search URL, both read once at construction, so a process that exports
 * the env var can call the factory with no arguments.
 */
export interface CreateBraveWebSearchAdapterOptions {
  /** Brave API key. Defaults to `process.env.BRAVE_API_KEY`. */
  apiKey?: string;
  /** Injectable fetch (default `globalThis.fetch`) — set in tests for offline runs. */
  fetchImpl?: FetchLike;
  /** Override the Brave endpoint (self-host / test). */
  endpoint?: string;
}

interface BraveResult {
  title?: unknown;
  url?: unknown;
  description?: unknown;
}

/**
 * Build a `WebSearchCallback` backed by the Brave Search API. Throws a typed
 * `ConfigurationError` ("no_api_key") at creation when no key is available.
 */
export function createBraveWebSearchAdapter(
  opts: CreateBraveWebSearchAdapterOptions = {},
): WebSearchCallback {
  const apiKey = opts.apiKey ?? process.env.BRAVE_API_KEY;
  if (!apiKey) {
    throw new ConfigurationError("BRAVE_API_KEY is not set (pass { apiKey } or set the env var).", {
      code: "no_api_key",
    });
  }
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const endpoint = opts.endpoint ?? BRAVE_ENDPOINT;
  // Validate the endpoint at creation (fail-early symmetry with the key check).
  const base = new URL(endpoint);

  return async (query: string, maxResults: number): Promise<WebSearchResult[]> => {
    const url = new URL(base);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(maxResults));
    const res = await fetchImpl(url.toString(), {
      headers: { "X-Subscription-Token": apiKey, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`brave_search_failed: HTTP ${res.status}`);
    const json = (await res.json()) as { web?: { results?: BraveResult[] } } | null;
    const results = json?.web?.results ?? [];
    return results.map((r) => ({
      title: String(r?.title ?? ""),
      url: String(r?.url ?? ""),
      snippet: String(r?.description ?? ""),
    }));
  };
}
