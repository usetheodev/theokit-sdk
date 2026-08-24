/**
 * `web_search` — built-in tool for coding agents.
 *
 * Accepts a search callback via DIP (consumer provides the search
 * provider). The tool itself is provider-agnostic.
 *
 * Return shape (always a JSON string):
 *   - `{ ok: true, results: Array<{ title, url, snippet }> }`
 *   - `{ ok: false, error: 'search_failed' | 'no_provider' }`
 */

import type { CustomTool } from "@theokit/sdk";

import { Tool } from "@theokit/sdk";
import { z } from "zod";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * The search provider {@link createWebSearchTool} calls.
 *
 * `maxResults` is what the caller asked for, not a limit you must enforce — the tool slices the array
 * itself — but returning far more than asked wastes the round trip that produced them.
 *
 * Reject the promise to signal a failed search: the tool turns a rejection into
 * `{ ok: false, error: "search_failed" }` and never lets it escape into the agent turn. Resolving
 * with `[]` says something different — that the search ran and found nothing.
 */
export type WebSearchCallback = (query: string, maxResults: number) => Promise<WebSearchResult[]>;

/**
 * Options for {@link createWebSearchTool}. `search` is required: the tool ships no provider of its
 * own, and the two adapters in this package — {@link createBraveWebSearchAdapter} and
 * {@link createGenericHttpSearchAdapter} — exist to fill it.
 */
export interface CreateWebSearchToolOptions {
  /** M76 — name exposed to the model. Omitted => today's literal (additive). The name is a contract:
   *  the approval key, what the model sees and what telemetry records. */
  name?: string;
  /** M76 — description exposed to the model. Omitted => today's literal (additive). */
  description?: string;
  /** Search provider callback — consumer injects the implementation. */
  search: WebSearchCallback;
  /** Default max results if not specified by the LLM. */
  defaultMaxResults?: number;
}

/**
 * Build the `web_search` tool over a caller-supplied provider.
 *
 * The tool holds no API key and talks to no service; everything network-facing lives in the `search`
 * callback, which is why one tool serves Brave, a self-hosted endpoint, or a fixture in a test. Use
 * it to find pages and `web_fetch` to read one — results carry a snippet, not a body.
 *
 * The model's `max_results` (1..20) wins over `defaultMaxResults`, and the list is sliced to it even
 * when the provider returns more. A rejecting provider yields `{ ok: false, error: "search_failed" }`
 * with its message attached; a provider resolving `[]` yields `{ ok: true, results: [] }`. The two
 * are different signals, so an adapter that swallows its own failures — as
 * {@link createGenericHttpSearchAdapter} deliberately does — reports the first as the second.
 */
export function createWebSearchTool(opts: CreateWebSearchToolOptions): CustomTool {
  const { search, defaultMaxResults = 5 } = opts;

  return Tool.create({
    name: opts.name ?? "web_search",
    description:
      opts.description ??
      "Search the web for a query — use when you need current information beyond the repo or your " +
        "training cutoff (library docs, an error message, an API). Returns a list of results with " +
        "title, URL, and snippet; follow up with web_fetch on a promising result to read it in full. " +
        "The search provider is injected by the consumer. " +
        "Returns { ok, results } or { ok: false, error }.",
    inputSchema: z.object({
      query: z.string().min(1).describe("Search query."),
      max_results: z
        .number()
        .int()
        .positive()
        .max(20)
        .optional()
        .describe("Maximum results to return (default 5, max 20)."),
    }),
    handler: async ({ query, max_results }) => {
      const maxResults = max_results ?? defaultMaxResults;

      try {
        const results = await search(query, maxResults);
        return JSON.stringify({
          ok: true,
          results: results.slice(0, maxResults),
          count: Math.min(results.length, maxResults),
        });
      } catch (err) {
        const e = err as { message?: string };
        return JSON.stringify({
          ok: false,
          error: "search_failed",
          message: e.message ?? "unknown",
        });
      }
    },
  });
}
