/**
 * theokit#122 follow-up — the behavioural test that would have caught B1 and B2.
 *
 * The shape under test is the one the first fix got wrong and no test exercised: round 1 produces
 * extended thinking and a TOOL CALL with **no preamble text** (the common Anthropic shape), round 2
 * answers with text. The first fix consumed the block only where the assistant-text step is emitted,
 * so round 1's block was never consumed, survived on the LoopContext, and was persisted against
 * round 2's text — carrying a signature that no longer matched its body.
 *
 * The other two files cover this structurally (`thinking-round-scoping.test.ts`) and at the
 * persistence boundary (`thinking-signature-roundtrip.test.ts`). This one drives the real loop.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, onTestFinished } from "vitest";
import { runAgentLoop } from "../../../src/internal/agent-loop/loop.js";
import type { LlmClient, LlmEvent, LlmFinish } from "../../../src/internal/llm/types.js";
import { HooksExecutor } from "../../../src/internal/runtime/hooks/hooks-executor.js";
import type { ConversationTurn } from "../../../src/types/conversation.js";
import { removeTempDirRobust } from "../../helpers/temp-workspace.js";

const SIG_ROUND_1 = "SIGNATURE-FOR-ROUND-ONE";
const SIG_ROUND_2 = "SIGNATURE-FOR-ROUND-TWO";

/**
 * A stub whose round 1 streams thinking + a signature and finishes with a tool call and NO text —
 * exactly what Anthropic emits when the model reasons and then acts without narrating.
 */
function twoRoundThinkingClient(cwd: string): LlmClient {
  let round = 0;
  return {
    name: "stub",
    async *stream(): AsyncGenerator<LlmEvent, LlmFinish, void> {
      round += 1;
      if (round === 1) {
        yield { type: "reasoning_delta", text: "I should read the file." };
        yield { type: "reasoning_delta", text: "", signature: SIG_ROUND_1 };
        return {
          stopReason: "tool_use",
          text: "", // no preamble — the case the first fix dropped
          toolCalls: [
            {
              type: "tool_use",
              id: "call_1",
              name: "shell",
              input: { command: `cat ${join(cwd, "data.txt")}` },
            },
          ],
          thinking: { type: "thinking", text: "I should read the file.", signature: SIG_ROUND_1 },
        };
      }
      yield { type: "reasoning_delta", text: "Now I can answer." };
      yield { type: "reasoning_delta", text: "", signature: SIG_ROUND_2 };
      yield { type: "text_delta", text: "The answer is 42." };
      return {
        stopReason: "end_turn",
        text: "The answer is 42.",
        toolCalls: [],
        thinking: { type: "thinking", text: "Now I can answer.", signature: SIG_ROUND_2 },
      };
    },
  };
}

/** Every thinking step of the conversation, paired with the assistant text of its own turn. */
function thinkingByTurn(
  conversation: readonly ConversationTurn[],
): Array<{ thinking?: string; signature?: string; text?: string }> {
  return conversation
    .filter((t) => t.type === "agentConversationTurn")
    .map((t) => {
      const steps = t.turn.steps;
      const thinking = steps.find((s) => s.type === "thinkingMessage");
      const assistant = steps.find((s) => s.type === "assistantMessage");
      return {
        ...(thinking?.type === "thinkingMessage"
          ? { thinking: thinking.message.text, signature: thinking.message.signature }
          : {}),
        ...(assistant?.type === "assistantMessage" ? { text: assistant.message.text } : {}),
      };
    })
    .filter((entry) => Object.keys(entry).length > 0);
}

describe("theokit#122 — thinking stays with the round that produced it", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-thinking-"));
    const __cwdCleanup1 = cwd;
    onTestFinished(async () => {
      await removeTempDirRobust(__cwdCleanup1);
    });
    await writeFile(join(cwd, "data.txt"), "answer-is-42\n");
  });

  it("test_B1_round_1_signature_never_lands_on_round_2_text", async () => {
    const hooks = new HooksExecutor(cwd);
    await hooks.initialize(false);

    const result = await runAgentLoop({
      agentId: "agent-thinking",
      runId: "run-thinking",
      model: { id: "stub-model" },
      userMessage: "read data.txt",
      llm: twoRoundThinkingClient(cwd),
      mcp: new Map(),
      hooks,
      shellCwd: cwd,
      shellSandbox: false,
    });

    expect(result.finalStatus).toBe("finished");
    const turns = thinkingByTurn(result.conversation);

    // Round 1: thinking recorded on its OWN turn, even though that turn had no assistant text.
    // Before the fix this turn carried no thinking at all and SIG_ROUND_1 surfaced on round 2.
    const round1 = turns.find((t) => t.signature === SIG_ROUND_1);
    expect(round1, "round 1's block must be persisted with round 1").toBeDefined();
    expect(round1?.thinking).toBe("I should read the file.");
    expect(round1?.text, "round 1 produced no assistant text").toBeUndefined();

    // Round 2 carries its OWN signature next to its OWN text — never round 1's.
    const round2 = turns.find((t) => t.text === "The answer is 42.");
    expect(round2?.signature).toBe(SIG_ROUND_2);
    expect(round2?.thinking).toBe("Now I can answer.");
  }, 20_000);

  it("test_B2_the_tool_use_round_is_replayed_to_the_provider_with_its_signed_block", async () => {
    // The loop feeds `ctx.messages` back to the provider on round 2. If round 1's assistant turn
    // reaches Anthropic without its signed block, the request is rejected outright — which is the
    // failure enabling extended thinking on the request side made reachable.
    const seenRequests: Array<{ messages: unknown[] }> = [];
    const base = twoRoundThinkingClient(cwd);
    const recording: LlmClient = {
      name: "stub",
      async *stream(request, signal) {
        seenRequests.push({ messages: [...request.messages] });
        return yield* base.stream(request, signal);
      },
    };

    const hooks = new HooksExecutor(cwd);
    await hooks.initialize(false);
    await runAgentLoop({
      agentId: "agent-thinking-2",
      runId: "run-thinking-2",
      model: { id: "stub-model" },
      userMessage: "read data.txt",
      llm: recording,
      mcp: new Map(),
      hooks,
      shellCwd: cwd,
      shellSandbox: false,
    });

    expect(seenRequests.length).toBeGreaterThanOrEqual(2);
    const round2Messages = seenRequests[1]?.messages as Array<{
      role: string;
      content: Array<{ type: string; signature?: string }>;
    }>;
    const assistantTurn = round2Messages.find((m) => m.role === "assistant");

    expect(assistantTurn, "round 2 must replay round 1's assistant turn").toBeDefined();
    expect(assistantTurn?.content[0]?.type, "the signed block must LEAD the message").toBe(
      "thinking",
    );
    expect(assistantTurn?.content[0]?.signature).toBe(SIG_ROUND_1);
  }, 20_000);
});
