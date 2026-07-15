/**
 * SE39 — Claude Code transcript writer (read-only interop). Unit tests for the pure mapper
 * `claudeCodeRecords` + `encodeProjectDir`. The mapping must satisfy the schema the strict consumer
 * `claude-code-log` enforces (models.py): envelope fields + structured content blocks + the
 * tool_use_id ↔ tool_use.id pairing with ZERO dangling. A round-trip through the real parser is a
 * separate integration test.
 */
import { describe, expect, it } from "vitest";

import {
  claudeCodeRecords,
  encodeProjectDir,
} from "../../../src/internal/persistence/claude-code-transcript.js";
import type { ConversationStep } from "../../../src/types/conversation.js";

const BASE = {
  userMessage: "Compute 17 * 23 with the calculator.",
  cwd: "/home/u/proj",
  sessionId: "sess-1",
  model: "openai/gpt-4o-mini",
  version: "1.0.0-theokit",
  timestamp: "2026-07-15T12:00:00.000Z",
};

function blocks(rec: { message?: { content?: unknown } }): Array<Record<string, unknown>> {
  const c = rec.message?.content;
  return Array.isArray(c) ? (c as Array<Record<string, unknown>>) : [];
}

/** Collect tool_use ids + tool_result refs across all records (keeps the tests flat). */
function collectToolIds(recs: Array<{ message?: { content?: unknown } }>): {
  useIds: Set<string>;
  resultRefs: Set<string>;
} {
  const useIds = new Set<string>();
  const resultRefs = new Set<string>();
  for (const r of recs) {
    for (const b of blocks(r)) {
      if (b.type === "tool_use") useIds.add(b.id as string);
      if (b.type === "tool_result") resultRefs.add(b.tool_use_id as string);
    }
  }
  return { useIds, resultRefs };
}

describe("SE39 — claudeCodeRecords (Claude Code transcript mapper)", () => {
  it("encodeProjectDir replaces non-alphanumerics with '-' (Claude Code path convention)", () => {
    expect(encodeProjectDir("/home/u/proj")).toBe("-home-u-proj");
    expect(encodeProjectDir("/a.b/c-d")).toBe("-a-b-c-d");
  });

  it("emits a leading user record with the prompt as a text block + full envelope", () => {
    const recs = claudeCodeRecords([], BASE);
    expect(recs).toHaveLength(1);
    const u = recs[0]!;
    // envelope required by claude-code-log models.py BaseTranscriptEntry
    for (const k of [
      "type",
      "uuid",
      "parentUuid",
      "isSidechain",
      "userType",
      "cwd",
      "sessionId",
      "version",
      "timestamp",
    ]) {
      expect(u).toHaveProperty(k);
    }
    expect(u.type).toBe("user");
    expect(u.parentUuid).toBeNull();
    expect(u.isSidechain).toBe(false);
    expect(u.sessionId).toBe("sess-1");
    expect(u.cwd).toBe("/home/u/proj");
    expect(blocks(u)).toEqual([{ type: "text", text: BASE.userMessage }]);
  });

  it("groups an assistant turn (thinking + text + tool_use) into ONE assistant record", () => {
    const steps: ConversationStep[] = [
      { type: "thinkingMessage", message: { text: "let me multiply", thinkingDurationMs: 12 } },
      { type: "assistantMessage", message: { text: "I'll use the calculator." } },
      {
        type: "toolCall",
        message: { callId: "toolu_A", name: "calculator", args: { a: 17, b: 23 } },
      },
    ];
    const recs = claudeCodeRecords(steps, BASE);
    const asst = recs.find((r) => r.type === "assistant")!;
    // assistant message must carry id/type/role/model (AssistantMessageModel required fields)
    expect(asst.message).toMatchObject({ type: "message", role: "assistant", model: BASE.model });
    expect(asst.message).toHaveProperty("id");
    const bt = blocks(asst).map((b) => b.type);
    expect(bt).toEqual(["thinking", "text", "tool_use"]);
    const toolUse = blocks(asst).find((b) => b.type === "tool_use")!;
    expect(toolUse).toMatchObject({ id: "toolu_A", name: "calculator", input: { a: 17, b: 23 } });
  });

  it("emits a user record with a tool_result whose tool_use_id matches the tool_use id (no dangling)", () => {
    const steps: ConversationStep[] = [
      {
        type: "toolCall",
        message: { callId: "toolu_A", name: "calculator", args: { a: 17, b: 23 } },
      },
      {
        type: "toolResult",
        message: { callId: "toolu_A", name: "calculator", result: "391", isError: false },
      },
      { type: "assistantMessage", message: { text: "The answer is 391." } },
    ];
    const { useIds, resultRefs } = collectToolIds(claudeCodeRecords(steps, BASE));
    expect(useIds).toContain("toolu_A");
    expect(resultRefs).toContain("toolu_A");
    // ZERO dangling: every tool_use has a matching tool_result
    for (const id of useIds) expect(resultRefs.has(id)).toBe(true);
  });

  it("chains parentUuid so the records form a single DAG path (each points to the prior uuid)", () => {
    const steps: ConversationStep[] = [
      { type: "assistantMessage", message: { text: "hi" } },
      { type: "toolCall", message: { callId: "t1", name: "x", args: {} } },
      { type: "toolResult", message: { callId: "t1", name: "x", result: "ok", isError: false } },
      { type: "assistantMessage", message: { text: "done" } },
    ];
    const recs = claudeCodeRecords(steps, BASE);
    expect(recs.length).toBeGreaterThanOrEqual(4);
    expect(recs[0]!.parentUuid).toBeNull();
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i]!.parentUuid).toBe(recs[i - 1]!.uuid);
    }
    // uuids unique
    expect(new Set(recs.map((r) => r.uuid)).size).toBe(recs.length);
  });

  it("redacts secrets in text + tool content (security never sacrificed)", () => {
    const steps: ConversationStep[] = [
      {
        type: "assistantMessage",
        message: { text: "token is sk-abcdefghijklmnopqrstuvwx1234567890" },
      },
    ];
    const recs = claudeCodeRecords(steps, BASE);
    const asst = recs.find((r) => r.type === "assistant")!;
    const text = (blocks(asst).find((b) => b.type === "text")!.text as string) ?? "";
    expect(text).not.toContain("sk-abcdefghijklmnopqrstuvwx1234567890");
  });

  it("empty session yields just the user record (edge case)", () => {
    expect(claudeCodeRecords([], BASE)).toHaveLength(1);
  });
});
