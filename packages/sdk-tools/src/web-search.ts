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

export type WebSearchCallback = (query: string, maxResults: number) => Promise<WebSearchResult[]>;

export interface CreateWebSearchToolOptions {
  /** Search provider callback — consumer injects the implementation. */
  search: WebSearchCallback;
  /** Default max results if not specified by the LLM. */
  defaultMaxResults?: number;
}

export function createWebSearchTool(opts: CreateWebSearchToolOptions): CustomTool {
  const { search, defaultMaxResults = 5 } = opts;

  return Tool.create({
    name: "web_search",
    description:
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
