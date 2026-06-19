import { describe, expect, it, vi } from "vitest";

import {
  autoSummarize,
  type CompressibleMessage,
  resolveAutoSummarizeConfig,
  shouldSummarize,
} from "../../../src/internal/runtime/lifecycle/auto-summarize.js";

describe("shouldSummarize", () => {
  const config = resolveAutoSummarizeConfig({ triggerFraction: 0.85 });

  it("returns true when above threshold", () => {
    expect(shouldSummarize(900, 1000, config)).toBe(true);
  });

  it("returns false when below threshold", () => {
    expect(shouldSummarize(500, 1000, config)).toBe(false);
  });

  it("returns true at exact threshold", () => {
    expect(shouldSummarize(850, 1000, config)).toBe(true);
  });

  it("returns false when maxContextTokens is 0 (EC-8)", () => {
    expect(shouldSummarize(100, 0, config)).toBe(false);
  });

  it("returns false when maxContextTokens is negative", () => {
    expect(shouldSummarize(100, -1, config)).toBe(false);
  });
});

describe("autoSummarize", () => {
  const config = resolveAutoSummarizeConfig({
    keepNewest: 2,
    model: "test-model",
  });

  const makeMessages = (n: number): CompressibleMessage[] =>
    Array.from({ length: n }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `message ${i + 1}`,
    }));

  it("keeps newest N messages untouched", async () => {
    const messages = makeMessages(6);
    const callLlm = vi.fn().mockResolvedValue("summary of old messages");

    const result = await autoSummarize({ messages, config, callLlm });
    expect(result.length).toBe(3); // 1 summary + 2 kept
    expect(result[1]!.content).toBe("message 5");
    expect(result[2]!.content).toBe("message 6");
  });

  it("compresses older messages into one summary", async () => {
    const messages = makeMessages(6);
    const callLlm = vi.fn().mockResolvedValue("compressed summary");

    const result = await autoSummarize({ messages, config, callLlm });
    expect(result[0]!.role).toBe("system");
    expect(result[0]!.content).toContain("compressed summary");
  });

  it("passes custom model to callLlm", async () => {
    const messages = makeMessages(4);
    const callLlm = vi.fn().mockResolvedValue("summary");

    await autoSummarize({ messages, config, callLlm });
    expect(callLlm).toHaveBeenCalledWith(
      "test-model",
      expect.stringContaining("summarizer"),
      expect.stringContaining("message 1"),
    );
  });

  it("returns unchanged when fewer messages than keepNewest (EC-3)", async () => {
    const messages = makeMessages(2);
    const callLlm = vi.fn();

    const result = await autoSummarize({ messages, config, callLlm });
    expect(result).toBe(messages); // same reference
    expect(callLlm).not.toHaveBeenCalled();
  });

  it("returns unchanged when exactly keepNewest messages", async () => {
    const config2 = resolveAutoSummarizeConfig({ keepNewest: 4 });
    const messages = makeMessages(4);
    const callLlm = vi.fn();

    const result = await autoSummarize({ messages, config: config2, callLlm });
    expect(result).toBe(messages);
    expect(callLlm).not.toHaveBeenCalled();
  });

  it("uses default config values", () => {
    const defaults = resolveAutoSummarizeConfig();
    expect(defaults.triggerFraction).toBe(0.85);
    expect(defaults.keepNewest).toBe(4);
    expect(defaults.model).toBeUndefined();
  });
});
