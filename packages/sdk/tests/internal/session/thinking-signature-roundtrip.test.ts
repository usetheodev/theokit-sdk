/**
 * theokit#122 — persist a thinking block and get it back replayable.
 *
 * This is the assertion the issue is actually about: a session that used extended thinking must be
 * resumable. That needs the signature to survive persistence AND reconstruction, and the
 * reconstructed block to land back in the same assistant message it came from — Anthropic requires
 * the thinking block to be the first block of its message.
 *
 * Both links were broken independently: the loop never produced a `thinkingMessage` step (so
 * `mapAgentTurn`'s branch for it was unreachable and no thinking was ever persisted), and
 * `blockToPart` dropped thinking blocks on read.
 */
import { describe, expect, it } from "vitest";
import { toAnthropicWireMessage } from "../../../src/internal/llm/anthropic-shared.js";
import {
  reconstructMessages,
  SessionTranscript,
} from "../../../src/internal/persistence/session-transcript.js";
import { persistTurn } from "../../../src/internal/session/agent-session-store.js";
import type { SessionRecord } from "../../../src/types/session-record.js";
import type { SessionStore } from "../../../src/types/session-store.js";

const LOC = { cwd: "/home/u/proj", agentId: "agent-122", model: "claude-sonnet-4-6" };
const SIGNATURE = "ErUBCkYIBBgCIkAxyz+/opaque==";

function collectingStore(): SessionStore & { records: SessionRecord[] } {
  const records: SessionRecord[] = [];
  return {
    records,
    async readRecords() {
      return [...records];
    },
    async appendRecords(_id: string, delta: readonly SessionRecord[]) {
      records.push(...delta);
    },
  } as unknown as SessionStore & { records: SessionRecord[] };
}

describe("theokit#122 — a thinking block survives persist -> reconstruct -> replay", () => {
  it("test_the_signature_round_trips_through_the_transcript", async () => {
    const store = collectingStore();
    await persistTurn(store, LOC, LOC.agentId, {
      userText: "how many?",
      conversation: [
        {
          type: "agentConversationTurn",
          turn: {
            // The shape the loop now produces: thinking and text in ONE turn, thinking first.
            steps: [
              { type: "thinkingMessage", message: { text: "Let me count.", signature: SIGNATURE } },
              { type: "assistantMessage", message: { text: "Four." } },
            ],
          },
        },
      ],
    });

    const messages = reconstructMessages(store.records);
    const assistant = messages.find((m) => m.role === "assistant");

    expect(assistant?.content).toEqual([
      { type: "thinking", text: "Let me count.", signature: SIGNATURE },
      { type: "text", text: "Four." },
    ]);
  });

  it("test_the_reconstructed_block_replays_to_the_provider_unchanged", async () => {
    // The end of the chain, and the only thing Anthropic actually validates: text and signature
    // must go back byte-identically.
    const store = collectingStore();
    await persistTurn(store, LOC, LOC.agentId, {
      userText: "how many?",
      conversation: [
        {
          type: "agentConversationTurn",
          turn: {
            steps: [
              { type: "thinkingMessage", message: { text: "Let me count.", signature: SIGNATURE } },
              { type: "assistantMessage", message: { text: "Four." } },
            ],
          },
        },
      ],
    });

    const assistant = reconstructMessages(store.records).find((m) => m.role === "assistant");
    const wire = toAnthropicWireMessage(assistant as never);

    expect((wire.content as unknown[])[0]).toEqual({
      type: "thinking",
      thinking: "Let me count.",
      signature: SIGNATURE,
    });
  });

  it("test_thinking_stays_in_the_SAME_assistant_message_as_its_text", async () => {
    // Anthropic requires the thinking block to be the first block of the message it belongs to.
    // Persisting it as its own assistant record would produce two assistant messages and fail.
    const store = collectingStore();
    await persistTurn(store, LOC, LOC.agentId, {
      userText: "how many?",
      conversation: [
        {
          type: "agentConversationTurn",
          turn: {
            steps: [
              { type: "thinkingMessage", message: { text: "Let me count.", signature: SIGNATURE } },
              { type: "assistantMessage", message: { text: "Four." } },
            ],
          },
        },
      ],
    });

    const assistants = reconstructMessages(store.records).filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0]?.content[0]?.type).toBe("thinking");
  });

  it("test_COUNTERPROOF_an_unsigned_thinking_block_round_trips_but_is_not_replayed", async () => {
    // History written before this shipped has thinking text and no signature. It must not vanish
    // from the transcript (it is real history), and must not be sent to Anthropic (an unsigned
    // block fails the same validation as a modified one).
    const t = new SessionTranscript({ cwd: LOC.cwd, sessionId: LOC.agentId, model: LOC.model });
    t.appendUserTurn("how many?");
    t.appendAssistantTurn({ thinking: "old unsigned reasoning", text: "Four." });

    const assistant = reconstructMessages([...t.records()]).find((m) => m.role === "assistant");
    expect(assistant?.content[0]).toEqual({ type: "thinking", text: "old unsigned reasoning" });

    const wire = toAnthropicWireMessage(assistant as never);
    expect(wire.content).toEqual([{ type: "text", text: "Four." }]);
  });
});
