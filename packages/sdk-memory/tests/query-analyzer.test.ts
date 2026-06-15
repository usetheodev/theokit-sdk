import { describe, expect, it, vi } from "vitest";

import { analyzeQuery } from "../src/internal/active-memory/query-analyzer.js";

describe("analyzeQuery", () => {
  it("short query returns unchanged without LLM call", async () => {
    const callLlm = vi.fn();
    const result = await analyzeQuery("hello world", callLlm);
    expect(result.subQueries).toEqual(["hello world"]);
    expect(callLlm).not.toHaveBeenCalled();
  });

  it("long query calls LLM", async () => {
    const longQuery = "x".repeat(300);
    const callLlm = vi.fn().mockResolvedValue('{"subQueries":["sub1","sub2"]}');
    const result = await analyzeQuery(longQuery, callLlm);
    expect(callLlm).toHaveBeenCalledOnce();
    expect(result.subQueries).toEqual(["sub1", "sub2"]);
  });

  it("returns sub-queries from LLM response", async () => {
    const longQuery = "a".repeat(300);
    const callLlm = vi.fn().mockResolvedValue('{"subQueries":["query1","query2","query3"]}');
    const result = await analyzeQuery(longQuery, callLlm);
    expect(result.subQueries).toHaveLength(3);
  });

  it("returns timeFilter when LLM provides it", async () => {
    const longQuery = "b".repeat(300);
    const callLlm = vi.fn().mockResolvedValue('{"subQueries":["q1"],"timeFilter":1234567890}');
    const result = await analyzeQuery(longQuery, callLlm);
    expect(result.timeFilter).toBe(1234567890);
  });

  it("falls back to original query when LLM throws", async () => {
    const longQuery = "c".repeat(300);
    const callLlm = vi.fn().mockRejectedValue(new Error("LLM error"));
    const result = await analyzeQuery(longQuery, callLlm);
    expect(result.subQueries).toEqual([longQuery]);
  });

  it("falls back on malformed JSON (EC-4)", async () => {
    const longQuery = "d".repeat(300);
    const callLlm = vi.fn().mockResolvedValue("Here are some sub-queries: 1. first 2. second");
    const result = await analyzeQuery(longQuery, callLlm);
    expect(result.subQueries).toEqual([longQuery]);
  });

  it("empty query returns as-is", async () => {
    const callLlm = vi.fn();
    const result = await analyzeQuery("", callLlm);
    expect(result.subQueries).toEqual([""]);
    expect(callLlm).not.toHaveBeenCalled();
  });
});
