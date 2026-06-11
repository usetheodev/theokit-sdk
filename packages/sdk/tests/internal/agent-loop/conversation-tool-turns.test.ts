/**
 * T2.3 — Conversation log includes tool call + tool result steps
 * (DR2 finding #3 — parity with OpenAI Agents RunResult.new_items).
 *
 * Pre-T2.3 `ctx.conversation` only received `assistantMessage` steps.
 * Tool calls and their results were pushed to `ctx.messages` (LLM
 * history) but NOT to the structured conversation log returned via
 * `Run.conversation()`. Consumers had no way to reconstruct the full
 * interaction including tool usage.
 *
 * T2.3 adds:
 * (a) `toolResult` variant to `ConversationStep` union
 * (b) Push of tool call + result into `ctx.conversation` after dispatch
 */

import { describe, expect, it } from "vitest";
import type { ConversationStep } from "../../../src/types/conversation.js";

describe("T2.3 — ConversationStep union includes toolResult", () => {
  it("accepts a toolResult step (type-level + runtime)", () => {
    const step: ConversationStep = {
      type: "toolResult",
      message: { callId: "call-1", name: "search", result: "42", isError: false },
    };
    expect(step.type).toBe("toolResult");
    expect(step.message.name).toBe("search");
    expect(step.message.result).toBe("42");
    expect(step.message.isError).toBe(false);
  });

  it("existing toolCall step still valid", () => {
    const step: ConversationStep = {
      type: "toolCall",
      message: { callId: "call-1", name: "search", args: { query: "hello" } },
    };
    expect(step.type).toBe("toolCall");
  });

  it("existing assistantMessage step still valid", () => {
    const step: ConversationStep = {
      type: "assistantMessage",
      message: { text: "Hello!" },
    };
    expect(step.type).toBe("assistantMessage");
  });
});
