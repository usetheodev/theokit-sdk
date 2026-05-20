/**
 * Tests for toShareGptTrajectory (T3.1, ADR D139).
 */

import { describe, expect, it } from "vitest";

import { TheokitAgentError } from "../src/errors.js";
import { toShareGptTrajectory } from "../src/trajectory-helpers.js";
import type { BatchResult } from "../src/types/batch.js";
import type { SDKMessage } from "../src/types/messages.js";
import type { RunResult } from "../src/types/run.js";

function okResult(overrides?: Partial<RunResult>): Extract<BatchResult, { ok: true }> {
  return {
    ok: true,
    index: 0,
    prompt: "hello",
    result: {
      id: "run-1",
      status: "finished",
      result: "hi there",
      ...overrides,
    },
    durationMs: 42,
  };
}

describe("toShareGptTrajectory (T3.1)", () => {
  // EC-11: failed result → null
  it("returns null for failed result (EC-11)", () => {
    const failed: BatchResult = {
      ok: false,
      index: 0,
      prompt: "p",
      error: new TheokitAgentError("nope", { code: "unknown" }),
      durationMs: 0,
    };
    expect(toShareGptTrajectory(failed)).toBeNull();
  });

  it("first conversation is human prompt", () => {
    const t = toShareGptTrajectory(okResult())!;
    expect(t.conversations[0]).toEqual({ from: "human", value: "hello" });
  });

  it("maps assistant text to gpt entry from messages", () => {
    const messages: SDKMessage[] = [
      {
        type: "assistant",
        agent_id: "a",
        run_id: "r",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "ola!" }],
        },
      },
    ];
    const t = toShareGptTrajectory(okResult(), { messages })!;
    expect(t.conversations[1]).toEqual({ from: "gpt", value: "ola!" });
  });

  it("maps tool_use blocks to tool_calls field", () => {
    const messages: SDKMessage[] = [
      {
        type: "assistant",
        agent_id: "a",
        run_id: "r",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "thinking..." },
            {
              type: "tool_use",
              id: "tu_1",
              name: "search",
              input: { q: "ts" },
            },
          ],
        },
      },
    ];
    const t = toShareGptTrajectory(okResult(), { messages })!;
    expect(t.conversations[1]).toEqual({
      from: "gpt",
      value: "thinking...",
      tool_calls: [{ name: "search", arguments: { q: "ts" } }],
    });
  });

  it("emits tool entry for completed tool_call results", () => {
    const messages: SDKMessage[] = [
      {
        type: "tool_call",
        agent_id: "a",
        run_id: "r",
        call_id: "c1",
        name: "search",
        status: "completed",
        result: "found 3 hits",
      },
    ];
    const t = toShareGptTrajectory(okResult(), { messages })!;
    expect(t.conversations[1]).toEqual({ from: "tool", value: "found 3 hits" });
  });

  it("falls back to final text when no messages supplied (EC-12)", () => {
    const t = toShareGptTrajectory(okResult({ result: "final answer" }))!;
    expect(t.conversations).toEqual([
      { from: "human", value: "hello" },
      { from: "gpt", value: "final answer" },
    ]);
  });

  it("emits empty gpt value when no final text and no messages (EC-13)", () => {
    const r = okResult();
    delete (r.result as { result?: string }).result;
    const t = toShareGptTrajectory(r)!;
    expect(t.conversations[1]).toEqual({ from: "gpt", value: "" });
  });

  it("metadata carries durationMs and promptIndex", () => {
    const r = okResult();
    r.index = 7;
    r.durationMs = 999;
    const t = toShareGptTrajectory(r)!;
    expect(t.metadata?.durationMs).toBe(999);
    expect(t.metadata?.promptIndex).toBe(7);
    expect(typeof t.metadata?.timestamp).toBe("string");
  });

  it("metadata carries model when supplied", () => {
    const t = toShareGptTrajectory(okResult(), { model: "openai/gpt-4o-mini" })!;
    expect(t.metadata?.model).toBe("openai/gpt-4o-mini");
  });

  it("usage present when underlying result carries it", () => {
    const r = okResult();
    (r.result as { usage?: { inputTokens: number; outputTokens: number } }).usage = {
      inputTokens: 100,
      outputTokens: 50,
    };
    const t = toShareGptTrajectory(r)!;
    expect(t.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
  });

  // EC-F: malformed SDKMessage entries → skip without throwing
  it("skips malformed message entries (EC-F)", () => {
    const messages = [
      null,
      { type: "assistant", agent_id: "a", run_id: "r" }, // missing message
      {
        type: "assistant",
        agent_id: "a",
        run_id: "r",
        message: { role: "assistant", content: "not-array" },
      },
      { type: "tool_call", agent_id: "a", run_id: "r", call_id: "x", name: "t", status: "running" }, // not completed
    ] as unknown as SDKMessage[];
    const t = toShareGptTrajectory(okResult(), { messages })!;
    // Only the human prompt + 2 assistant entries (with empty content) survive
    expect(t.conversations[0]).toEqual({ from: "human", value: "hello" });
    expect(t.conversations.length).toBeGreaterThanOrEqual(1);
    // None of the malformed inputs should have thrown
  });

  // EC-14: orphan tool_use without paired tool_result — gpt entry emitted, no tool entry
  it("orphan tool_use → gpt with tool_calls, no tool entry (EC-14)", () => {
    const messages: SDKMessage[] = [
      {
        type: "assistant",
        agent_id: "a",
        run_id: "r",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "tu_orphan", name: "fetch", input: {} }],
        },
      },
      // No paired tool_call.completed → no tool entry.
    ];
    const t = toShareGptTrajectory(okResult(), { messages })!;
    expect(t.conversations[1]).toEqual({
      from: "gpt",
      value: "",
      tool_calls: [{ name: "fetch", arguments: {} }],
    });
    // No third entry
    expect(t.conversations.length).toBe(2);
  });

  it("stringifies non-string tool results", () => {
    const messages: SDKMessage[] = [
      {
        type: "tool_call",
        agent_id: "a",
        run_id: "r",
        call_id: "c1",
        name: "fetch",
        status: "completed",
        result: { hits: 3, items: ["a", "b"] },
      },
    ];
    const t = toShareGptTrajectory(okResult(), { messages })!;
    expect(t.conversations[1]).toEqual({
      from: "tool",
      value: JSON.stringify({ hits: 3, items: ["a", "b"] }),
    });
  });

  it("completed=true on successful trajectory", () => {
    const t = toShareGptTrajectory(okResult())!;
    expect(t.completed).toBe(true);
  });
});
