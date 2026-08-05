/**
 * theokit#122 follow-up — the four defects `/review` found in the first version of this fix.
 *
 * That version parked the round's thinking block on `LoopContext.pendingThinking` and consumed it
 * only where the assistant TEXT step is emitted. Three things followed, all of them producing the
 * exact `400 "thinking blocks cannot be modified"` the issue exists to remove:
 *
 *  B1  a round of thinking + tool_use with no preamble text never consumed the block, so it leaked
 *      into the NEXT round and was persisted against the wrong text;
 *  B2  `buildAssistantTurn` never carried it, so the replayed assistant message lost it — and the
 *      same commit had enabled extended thinking on the request, making that reachable;
 *  M1  redaction rewrote the thinking TEXT while keeping the signature, persisting a pair that
 *      cannot verify;
 *  M2  `LlmFinish.thinking` was produced and read by nobody.
 *
 * These tests pin the shape that makes B1 unrepresentable: the block is a per-ROUND value.
 */
import { describe, expect, it } from "vitest";
import { buildAssistantTurn } from "../../../src/internal/agent-loop/message-builders.js";
import { toAnthropicWireMessage } from "../../../src/internal/llm/anthropic-shared.js";
import type { LlmThinkingPart } from "../../../src/internal/llm/types.js";
import {
  reconstructMessages,
  SessionTranscript,
} from "../../../src/internal/persistence/session-transcript.js";

const SIGNATURE = "ErUBCkYIBBgCIkAxyz+/opaque==";

describe("theokit#122 — the thinking block is scoped to its own round", () => {
  it("test_B1_the_loop_context_carries_no_thinking_state_to_leak", async () => {
    // The structural guarantee. `pendingThinking` was context state consumed on one of two exit
    // paths; a value that only ever lives on the round's output cannot be attached to a later one.
    const ctxModule = await import("../../../src/internal/agent-loop/loop-context-init.js");
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(
        new URL("../../../src/internal/agent-loop/loop-context-init.ts", import.meta.url),
        "utf8",
      ),
    );

    expect(source).not.toContain("pendingThinking");
    expect(Object.keys(ctxModule)).not.toContain("pendingThinking");
  });

  it("test_B2_the_replayed_assistant_turn_leads_with_the_signed_block", () => {
    const thinking: LlmThinkingPart = {
      type: "thinking",
      text: "Let me count.",
      signature: SIGNATURE,
    };

    const turn = buildAssistantTurn(
      "",
      [{ type: "tool_use", id: "c1", name: "shell", input: {} }],
      thinking,
    );

    // Anthropic requires the thinking block to LEAD the message it belongs to.
    expect(turn.content[0]).toEqual(thinking);
    // ...and it must survive serialization, which is what the provider actually validates.
    const wire = toAnthropicWireMessage(turn);
    expect((wire.content as unknown[])[0]).toEqual({
      type: "thinking",
      thinking: "Let me count.",
      signature: SIGNATURE,
    });
  });

  it("test_B2_COUNTERPROOF_a_round_with_no_thinking_builds_the_same_turn_as_before", () => {
    // The parameter is optional; every pre-existing caller must be unaffected.
    const turn = buildAssistantTurn("hi", [
      { type: "tool_use", id: "c1", name: "shell", input: {} },
    ]);

    expect(turn.content).toEqual([
      { type: "text", text: "hi" },
      { type: "tool_use", id: "c1", name: "shell", input: {} },
    ]);
  });

  it("test_M1_redaction_of_the_text_drops_the_signature_rather_than_persisting_a_broken_pair", () => {
    // A signature is computed over the ORIGINAL text. Redaction rewrites the text, so keeping the
    // signature would persist a pair Anthropic rejects outright — losing the whole turn instead of
    // one block of context.
    const t = new SessionTranscript({
      cwd: "/home/u/proj",
      sessionId: "agent-122",
      model: "claude-sonnet-4-6",
    });
    t.appendUserTurn("check the key");
    t.appendAssistantTurn({
      thinking: "the token is sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      thinkingSignature: SIGNATURE,
      text: "done",
    });

    const assistant = reconstructMessages([...t.records()]).find((m) => m.role === "assistant");
    const block = assistant?.content.find((p) => p.type === "thinking");

    expect(block, "the block itself is real history and must survive").toBeDefined();
    expect(block).not.toHaveProperty("signature");
    // And an unsigned block is not replayed — that policy lives at the wire.
    const wire = toAnthropicWireMessage(assistant as never);
    expect(wire.content).toEqual([{ type: "text", text: "done" }]);
  });

  it("test_M1_COUNTERPROOF_text_that_redaction_leaves_alone_keeps_its_signature", () => {
    // Without this, "drop the signature" could be implemented as "never keep the signature" and
    // still pass the test above — which would silently un-fix the whole issue.
    const t = new SessionTranscript({
      cwd: "/home/u/proj",
      sessionId: "agent-122",
      model: "claude-sonnet-4-6",
    });
    t.appendUserTurn("how many?");
    t.appendAssistantTurn({
      thinking: "Let me count. Four.",
      thinkingSignature: SIGNATURE,
      text: "Four.",
    });

    const assistant = reconstructMessages([...t.records()]).find((m) => m.role === "assistant");

    expect(assistant?.content[0]).toEqual({
      type: "thinking",
      text: "Let me count. Four.",
      signature: SIGNATURE,
    });
  });
});
