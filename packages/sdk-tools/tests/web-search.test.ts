import { describe, expect, it } from "vitest";
import type { WebSearchResult } from "../src/web-search.js";
import { createWebSearchTool } from "../src/web-search.js";
import { textHandler } from "./text-handler.js";

const mockResults: WebSearchResult[] = [
  { title: "Result 1", url: "https://example.com/1", snippet: "First result" },
  { title: "Result 2", url: "https://example.com/2", snippet: "Second result" },
  { title: "Result 3", url: "https://example.com/3", snippet: "Third result" },
];

describe("createWebSearchTool — tool shape", () => {
  it("Given the factory with a search callback, Then returns a CustomTool with name='web_search'", () => {
    const tool = createWebSearchTool({ search: async () => [] });
    expect(tool.name).toBe("web_search");
    expect(typeof tool.handler).toBe("function");
  });
});

describe("createWebSearchTool — happy path", () => {
  it("Given a search callback returning results, When searched, Then results are returned", async () => {
    const tool = createWebSearchTool({
      search: async () => mockResults,
    });
    const out = await textHandler(tool)({ query: "test query" });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.results).toHaveLength(3);
    expect(parsed.results[0].title).toBe("Result 1");
  });

  it("Given max_results=2, Then only 2 results are returned", async () => {
    const tool = createWebSearchTool({
      search: async () => mockResults,
    });
    const out = await textHandler(tool)({ query: "test", max_results: 2 });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.results).toHaveLength(2);
    expect(parsed.count).toBe(2);
  });

  it("Given defaultMaxResults=1, When no max_results provided, Then 1 result returned", async () => {
    const tool = createWebSearchTool({
      search: async () => mockResults,
      defaultMaxResults: 1,
    });
    const out = await textHandler(tool)({ query: "test" });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.results).toHaveLength(1);
  });
});

describe("createWebSearchTool — error scenarios", () => {
  it("Given search callback throws, Then result is { ok: false, error: 'search_failed' }", async () => {
    const tool = createWebSearchTool({
      search: async () => {
        throw new Error("API rate limit exceeded");
      },
    });
    const out = await textHandler(tool)({ query: "test" });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("search_failed");
    expect(parsed.message).toBe("API rate limit exceeded");
  });

  it("Given search callback returns empty, Then result is ok with empty array", async () => {
    const tool = createWebSearchTool({
      search: async () => [],
    });
    const out = await textHandler(tool)({ query: "nothing" });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.results).toHaveLength(0);
  });
});

describe("createWebSearchTool — DIP contract", () => {
  it("Given the callback receives query and maxResults, Then they are passed correctly", async () => {
    let receivedQuery = "";
    let receivedMax = 0;
    const tool = createWebSearchTool({
      search: async (query, maxResults) => {
        receivedQuery = query;
        receivedMax = maxResults;
        return [];
      },
    });
    await textHandler(tool)({ query: "test query", max_results: 7 });
    expect(receivedQuery).toBe("test query");
    expect(receivedMax).toBe(7);
  });
});
