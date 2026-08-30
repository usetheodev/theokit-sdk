/**
 * sdk-memory `memory_search` LLM-facing tool tests (iter 35).
 *
 * The LLM calls `memory_search({ query })` when the user asks about
 * something it might have learned in a previous session. The tool
 * queries the disk-backed sessions corpus + returns up to 5 snippets
 * as JSON.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createInMemoryMarkdownProvider, resolveMemoryRoot } from "@theokit/sdk-memory";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { textHandler } from "./text-handler.js";

const FAKE_AGENT = { agentId: "test-agent", model: undefined } as never;

interface SearchResult {
  ok: boolean;
  count?: number;
  error?: string;
  results?: Array<{ id: string; snippet: string }>;
}

describe("memory_search LLM-facing tool (iter 35)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "sdk-memory-search-"));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("test_memory_search_is_surfaced_alongside_memory_remember", async () => {
    const provider = createInMemoryMarkdownProvider();
    const handle = await provider.init({ cwd });
    const tools = provider.buildTools(handle, FAKE_AGENT);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["memory_remember", "memory_search"]);
  });

  it("test_memory_search_input_schema_canonical_shape", async () => {
    const provider = createInMemoryMarkdownProvider();
    const handle = await provider.init({ cwd });
    const tools = provider.buildTools(handle, FAKE_AGENT);
    const search = tools.find((t) => t.name === "memory_search");
    expect(search).toBeDefined();
    if (search === undefined) return;
    expect(search.description).toContain("Search past session");
    expect(search.inputSchema).toMatchObject({
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    });
  });

  it("test_memory_search_returns_disk_hits_for_matching_query", async () => {
    const provider = createInMemoryMarkdownProvider();
    const handle = await provider.init({ cwd });
    if (provider.recordSessionSummary === undefined) {
      throw new Error("missing recordSessionSummary");
    }
    await provider.recordSessionSummary({
      cwd: cwd,
      memoryRoot: resolveMemoryRoot(cwd),
      runId: "past-1",
      agentId: "agent-1",
      userText: "user is allergic to peanuts",
      assistantText: "noted",
      status: "finished",
      at: Date.now(),
    });

    const tools = provider.buildTools(handle, FAKE_AGENT);
    const search = tools.find((t) => t.name === "memory_search");
    if (search === undefined) throw new Error("missing memory_search");

    const raw = await textHandler(search)({ query: "peanuts" });
    const parsed = JSON.parse(raw) as SearchResult;
    expect(parsed.ok).toBe(true);
    expect(parsed.count).toBe(1);
    expect(parsed.results).toBeDefined();
    expect(parsed.results?.[0]?.snippet).toContain("peanuts");
  });

  it("test_memory_search_returns_empty_on_no_match", async () => {
    const provider = createInMemoryMarkdownProvider();
    const handle = await provider.init({ cwd });
    const tools = provider.buildTools(handle, FAKE_AGENT);
    const search = tools.find((t) => t.name === "memory_search");
    if (search === undefined) throw new Error("missing memory_search");

    const raw = await textHandler(search)({ query: "nonexistent-needle" });
    const parsed = JSON.parse(raw) as SearchResult;
    expect(parsed.ok).toBe(true);
    expect(parsed.count).toBe(0);
    expect(parsed.results).toEqual([]);
  });

  it("test_memory_search_rejects_empty_query", async () => {
    const provider = createInMemoryMarkdownProvider();
    const handle = await provider.init({ cwd });
    const tools = provider.buildTools(handle, FAKE_AGENT);
    const search = tools.find((t) => t.name === "memory_search");
    if (search === undefined) throw new Error("missing memory_search");

    const raw = await textHandler(search)({ query: "" });
    const parsed = JSON.parse(raw) as SearchResult;
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("empty query");
  });

  it("test_memory_search_returns_json_serializable_result", async () => {
    // The LLM sees the tool result as a string. Must be parseable JSON.
    const provider = createInMemoryMarkdownProvider();
    const handle = await provider.init({ cwd });
    const tools = provider.buildTools(handle, FAKE_AGENT);
    const search = tools.find((t) => t.name === "memory_search");
    if (search === undefined) throw new Error("missing memory_search");

    const raw = await textHandler(search)({ query: "anything" });
    expect(typeof raw).toBe("string");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("test_memory_search_caps_at_5_hits", async () => {
    // Mirror the runActivePass cap.
    const provider = createInMemoryMarkdownProvider();
    const handle = await provider.init({ cwd });
    if (provider.recordSessionSummary === undefined) throw new Error("missing");
    for (let i = 0; i < 7; i++) {
      await provider.recordSessionSummary({
        cwd: cwd,
        memoryRoot: resolveMemoryRoot(cwd),
        runId: `cap-${i}`,
        agentId: "a",
        userText: `shared-needle ${i}`,
        assistantText: "ok",
        status: "finished",
        at: Date.now(),
      });
    }
    const tools = provider.buildTools(handle, FAKE_AGENT);
    const search = tools.find((t) => t.name === "memory_search");
    if (search === undefined) throw new Error("missing");

    const raw = await textHandler(search)({ query: "shared-needle" });
    const parsed = JSON.parse(raw) as SearchResult;
    expect(parsed.count).toBe(5);
    expect(parsed.results?.length).toBe(5);
  });
});
