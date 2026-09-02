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
import { runAgentLoop } from "../../../src/internal/agent-loop/loop.js";
import { buildAssistantTurn } from "../../../src/internal/agent-loop/message-builders.js";
import { toAnthropicWireMessage } from "../../../src/internal/llm/anthropic-shared.js";
import type { LlmThinkingPart } from "../../../src/internal/llm/types.js";
import {
  reconstructMessages,
  SessionTranscript,
} from "../../../src/internal/persistence/session-transcript.js";
import { scriptedClient } from "../../helpers/scripted-client.js";
import { makeLoopInputs, makeLoopWorkspace } from "./_helpers/make-inputs.js";

const SIGNATURE = "ErUBCkYIBBgCIkAxyz+/opaque==";

describe("theokit#122 — the thinking block is scoped to its own round", () => {
  it("test_B1_a_round_1_block_never_crosses_into_a_round_2_that_produced_none", async () => {
    // B-077. This test used to read `loop-context-init.ts` as TEXT and assert it does not contain
    // the string "pendingThinking". Two ways that oracle was wrong in both directions: a rename of
    // the field keeps the leak and turns the test green, and a mention of the word in a comment
    // turns it red with no behaviour change at all. Its companion line —
    // `expect(Object.keys(ctxModule)).not.toContain("pendingThinking")`, which B-077's own DoD
    // credits as already covering the runtime surface — is no better: `pendingThinking` was a FIELD
    // on the LoopContext OBJECT, never a module export, so that assertion passes whether or not the
    // leak exists. Neither line could fail for the reason the test is named after.
    //
    // What the defect actually is: round state consumed on one of two exit paths. The shape that
    // exposes it is a round that never takes the consuming path — thinking + a tool call and NO
    // preamble text — followed by a round that produces text and NO thinking of its own. If the
    // block is parked on the context instead of riding the round's output, round 2's turn is the
    // one that gets round 1's signature, and the provider rejects the replay with the exact
    // `400 "thinking blocks cannot be modified"` this issue exists to remove.
    //
    // The sibling golden (`golden/agent-loop/thinking-two-round.golden.test.ts`) drives a round 2
    // that HAS its own block, so a leak there is masked by the overwrite. This one leaves round 2
    // empty, which is the only arrangement where a leaked block has nowhere to hide.
    const { cwd, hooks } = await makeLoopWorkspace("theokit-thinking-scope-");

    const { client, roundsAsked } = scriptedClient([
      {
        events: [{ type: "reasoning_delta", text: "I should call the tool." }],
        finish: {
          stopReason: "tool_use",
          text: "",
          toolCalls: [{ type: "tool_use", id: "call_1", name: "echo", input: {} }],
          thinking: { type: "thinking", text: "I should call the tool.", signature: SIGNATURE },
        },
      },
      {
        // Round 2 thinks about nothing. Any block on its turn came from somewhere else.
        events: [{ type: "text_delta", text: "done" }],
        finish: { stopReason: "end_turn", text: "done", toolCalls: [] },
      },
    ]);

    const result = await runAgentLoop(
      makeLoopInputs({
        agentId: "agent-122-scope",
        runId: "run-122-scope",
        userMessage: "go",
        llm: client,
        hooks,
        shellCwd: cwd,
        customTools: [
          {
            name: "echo",
            description: "returns a constant",
            inputSchema: { type: "object", properties: {} },
            handler: async () => "ok",
          },
        ],
      }),
    );

    expect(result.finalStatus).toBe("finished");
    expect(roundsAsked(), "the stub must have been asked for two rounds").toBe(2);

    const turns = result.conversation.filter((t) => t.type === "agentConversationTurn");
    const carryingSignature = turns.filter((t) =>
      t.turn.steps.some((s) => s.type === "thinkingMessage" && s.message.signature === SIGNATURE),
    );
    // Exactly one turn owns the block: the round that produced it.
    expect(carryingSignature).toHaveLength(1);

    // And it is NOT the turn that carries round 2's text. This is the assertion the source-text
    // oracle could never make: it fails when the block is parked on the context and replayed,
    // whatever the field is called.
    const roundTwoTurn = turns.find((t) =>
      t.turn.steps.some((s) => s.type === "assistantMessage" && s.message.text === "done"),
    );
    expect(roundTwoTurn, "round 2's text turn must exist").toBeDefined();
    expect(
      roundTwoTurn?.turn.steps.filter((s) => s.type === "thinkingMessage"),
      "round 2 produced no thinking, so its turn must carry none",
    ).toHaveLength(0);
  }, 20_000);

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
