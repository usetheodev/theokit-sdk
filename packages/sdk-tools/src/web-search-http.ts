/**
 * Generic HTTP web-search adapter for `createWebSearchTool` (RADAR #92.d).
 *
 * `createGenericHttpSearchAdapter()` returns a `WebSearchCallback` that queries
 * an arbitrary HTTP search endpoint keyed by env vars:
 *   - `THEOKIT_SEARCH_API_URL` — endpoint returning `{ results: [{title,url,snippet}] }`
 *   - `THEOKIT_SEARCH_API_KEY` — bearer token
 *
 * Request shape: `GET {endpoint}?q={query}&n={maxResults}` with
 * `Authorization: Bearer {apiKey}`. Both values may be passed explicitly (params
 * win over env). Unlike the Brave adapter (which fails early — fixed host, fixed
 * auth), this one is provider-agnostic and **degrades gracefully**: when
 * unconfigured OR on any network/parse failure it returns `[]` and never throws
 * into the agent turn. A recurring empty result is a provider-config issue, not
 * an agent bug. `fetchImpl` is injectable (default `globalThis.fetch`) for
 * offline tests. Zero new dependencies.
 *
 * Promoted from theocode's `server/lib/web-search.ts` (`createSearchProvider`),
 * re-keyed to neutral `THEOKIT_*` env vars.
 */

import type { WebSearchCallback, WebSearchResult } from "./web-search.js";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Options for {@link createGenericHttpSearchAdapter}. Unlike the Brave adapter, an absent `apiKey` or
 * `endpoint` is not an error — the callback is still built and simply returns no results — so if you
 * need to know whether search is actually configured, check both here rather than waiting for an
 * empty result set to tell you.
 */
export interface CreateGenericHttpSearchAdapterOptions {
  /** Bearer token. Defaults to `process.env.THEOKIT_SEARCH_API_KEY`. */
  apiKey?: string;
  /** Search endpoint URL. Defaults to `process.env.THEOKIT_SEARCH_API_URL`. */
  endpoint?: string;
  /** Injectable fetch (default `globalThis.fetch`) — set in tests for offline runs. */
  fetchImpl?: FetchLike;
}

interface GenericResult {
  title?: unknown;
  url?: unknown;
  snippet?: unknown;
}

/**
 * Build a `WebSearchCallback` backed by a generic HTTP search endpoint. Returns
 * `[]` (graceful no-op) when unconfigured or on any failure — never throws.
 */
export function createGenericHttpSearchAdapter(
  opts: CreateGenericHttpSearchAdapterOptions = {},
): WebSearchCallback {
  const apiKey = opts.apiKey ?? process.env.THEOKIT_SEARCH_API_KEY;
  const endpoint = opts.endpoint ?? process.env.THEOKIT_SEARCH_API_URL;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

  return async (query: string, maxResults: number): Promise<WebSearchResult[]> => {
    if (!apiKey || !endpoint) return []; // no provider configured — graceful no-op
    try {
      const url = `${endpoint}?q=${encodeURIComponent(query)}&n=${maxResults}`;
      const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!res.ok) return [];
      const data = (await res.json()) as { results?: GenericResult[] } | null;
      return (data?.results ?? []).slice(0, maxResults).map((r) => ({
        title: String(r?.title ?? ""),
        url: String(r?.url ?? ""),
        snippet: String(r?.snippet ?? ""),
      }));
    } catch {
      // Network/parse failure → no results (never throws into the agent turn).
      return [];
    }
  };
}
