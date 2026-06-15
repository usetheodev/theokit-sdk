/**
 * T2.2 step 3/N — compression summarizer function
 * (ADR D440 — provider-agnostic aux-LLM contract).
 *
 * Takes a ResolvedCompressionConfig + messages to compress and
 * returns a single summary message that replaces the compressed
 * window. The LLM call is injected via a `callLlm` parameter so
 * tests stay deterministic without real-LLM calls.
 *
 * The summarizer is the CORE of the D91/D92 compression wire —
 * step 4 plugs it into the agent-loop's
 * ContextWindowExceededError catch.
 */

import { describe, expect, it } from "vitest";
import {
  buildCompressionPrompt,
  compressConversationWindow,
} from "../../../src/internal/runtime/compression/compression-summarizer.js";

describe("T2.2 step 3 — buildCompressionPrompt", () => {
  it("builds a summarization system prompt with message count", () => {
    const messages = [
      { role: "user" as const, content: "Hello" },
      { role: "assistant" as const, content: "Hi there! How can I help?" },
      { role: "user" as const, content: "What is 2+2?" },
    ];
    const prompt = buildCompressionPrompt(messages);
    expect(prompt).toContain("3");
    expect(prompt).toMatch(/summar|compress|condense/i);
  });

  it("includes the conversation content in the user message", () => {
    const messages = [
      { role: "user" as const, content: "Tell me about cats" },
      { role: "assistant" as const, content: "Cats are wonderful pets." },
    ];
    const prompt = buildCompressionPrompt(messages);
    expect(prompt).toContain("cats");
    expect(prompt).toContain("wonderful pets");
  });
});

describe("T2.2 step 3 — compressConversationWindow", () => {
  it("returns a single summary message from the LLM response", async () => {
    const messages = [
      { role: "user" as const, content: "Hello" },
      { role: "assistant" as const, content: "Hi! I can help with math." },
      { role: "user" as const, content: "What is 2+2?" },
      { role: "assistant" as const, content: "2+2 equals 4." },
    ];

    const fakeLlm = async (_model: string, _system: string, _user: string) =>
      "Previous conversation: user greeted, asked about 2+2, answer was 4.";

    const result = await compressConversationWindow({
      messages,
      model: "openai/gpt-4o-mini",
      callLlm: fakeLlm,
    });

    expect(result.role).toBe("system");
    expect(result.content).toContain("2+2");
    expect(result.content).toContain("4");
  });

  it("throws CompressionFailedError when LLM call fails", async () => {
    const messages = [{ role: "user" as const, content: "Hello" }];

    const failingLlm = async () => {
      throw new Error("LLM 401");
    };

    await expect(
      compressConversationWindow({
        messages,
        model: "openai/gpt-4o-mini",
        callLlm: failingLlm,
      }),
    ).rejects.toThrow(/compress|failed|llm/i);
  });

  it("assertCompressionReduced rejects empty summary", async () => {
    const messages = [
      { role: "user" as const, content: "Hello world this is a long message" },
      { role: "assistant" as const, content: "Yes indeed it is quite long" },
    ];

    const emptyLlm = async () => "";

    await expect(
      compressConversationWindow({
        messages,
        model: "openai/gpt-4o-mini",
        callLlm: emptyLlm,
      }),
    ).rejects.toThrow(/empty|reduction|ineffective/i);
  });
});
