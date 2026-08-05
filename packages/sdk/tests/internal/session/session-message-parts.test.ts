/**
 * theokit#146 (RED-first) — a resumed session must replay tool history as STRUCTURE, not prose.
 *
 * The model-replay path is already correct: `reconstructMessages` rebuilds real `tool_use` /
 * `tool_result` parts from the transcript. The DISPLAY projection is where the information dies —
 * `partToText` renders a tool call as the literal string `[tool call] NAME`, dropping the call id
 * and every argument, and a result as `[tool result] <body>`.
 *
 * For a card-rendering host that means a resumed transcript comes back as flat text: no tool cards,
 * no arguments, no way to correlate a call with its result. agent-builder's response was to start a
 * fresh session on every launch, giving up cross-restart resume entirely — a regression against the
 * Codex `--continue` behaviour it was cloning.
 *
 * So the fix is additive: `text` keeps rendering exactly as before (nothing that reads it changes),
 * and `parts` carries the structure alongside it.
 */
import { describe, expect, it } from "vitest";
import { SessionTranscript } from "../../../src/internal/persistence/session-transcript.js";
import { readSessionMessages } from "../../../src/internal/session/agent-session-store.js";
import type { SessionRecord } from "../../../src/types/session-record.js";
import type { SessionStore } from "../../../src/types/session-store.js";

const LOC = { cwd: "/home/u/proj", agentId: "agent-146", model: "openai/gpt-4o-mini" };

function storeWith(records: readonly SessionRecord[]): SessionStore {
  return {
    async readRecords() {
      return [...records];
    },
    async appendRecords() {
      /* not exercised */
    },
  } as unknown as SessionStore;
}

/** A session whose assistant turn called one tool and received its result. */
function transcriptWithAToolCall(): SessionRecord[] {
  const t = new SessionTranscript({ cwd: LOC.cwd, sessionId: LOC.agentId, model: LOC.model });
  t.appendUserTurn("what files are here?");
  t.appendAssistantTurn({
    text: "Let me look.",
    toolCalls: [{ id: "call_42", name: "shell", input: { command: "ls -la", timeout: 5000 } }],
  });
  t.appendToolResults([{ toolUseId: "call_42", content: "README.md\npackage.json" }]);
  t.appendAssistantTurn({ text: "Two files." });
  return [...t.records()];
}

describe("theokit#146 — the resumed session projection keeps tool structure", () => {
  it("test_a_resumed_tool_call_keeps_its_id_name_and_arguments", async () => {
    const messages = await readSessionMessages(storeWith(transcriptWithAToolCall()), LOC.agentId);

    const call = messages.flatMap((m) => m.parts ?? []).find((p) => p.type === "tool_use");
    expect(call, "a resumed transcript must still contain the tool call").toBeDefined();
    // The three things `[tool call] shell` threw away, and the three a card UI needs.
    expect(call).toMatchObject({
      type: "tool_use",
      id: "call_42",
      name: "shell",
      input: { command: "ls -la", timeout: 5000 },
    });
  });

  it("test_a_resumed_tool_result_can_be_correlated_back_to_its_call", async () => {
    const messages = await readSessionMessages(storeWith(transcriptWithAToolCall()), LOC.agentId);

    const result = messages.flatMap((m) => m.parts ?? []).find((p) => p.type === "tool_result");
    expect(result).toMatchObject({
      type: "tool_result",
      toolUseId: "call_42",
      content: "README.md\npackage.json",
    });
  });

  it("test_the_text_projection_is_UNCHANGED_so_existing_readers_are_untouched", async () => {
    // The fix is additive by construction. `text` is what the runtime replays as prior context and
    // what every current consumer reads; changing it here would be a silent behaviour change
    // smuggled in under a display fix.
    const messages = await readSessionMessages(storeWith(transcriptWithAToolCall()), LOC.agentId);

    const joined = messages.map((m) => m.text).join("\n");
    expect(joined).toContain("[tool call] shell");
    expect(joined).toContain("[tool result] README.md\npackage.json");
    expect(joined).toContain("Let me look.");
  });

  it("test_a_text_only_session_carries_plain_text_parts", async () => {
    const t = new SessionTranscript({ cwd: LOC.cwd, sessionId: LOC.agentId, model: LOC.model });
    t.appendUserTurn("hello");
    t.appendAssistantTurn({ text: "hi" });

    const messages = await readSessionMessages(storeWith([...t.records()]), LOC.agentId);

    // No tool history is not the same as no structure: a host renders these as plain bubbles, and
    // must not have to guess whether `parts` is missing because the turn had none or because the
    // projection dropped them.
    expect(messages.map((m) => m.parts)).toEqual([
      [{ type: "text", text: "hello" }],
      [{ type: "text", text: "hi" }],
    ]);
  });
});
