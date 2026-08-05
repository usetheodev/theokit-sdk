/**
 * theokit#122 — where a round's thinking block becomes a conversation step.
 *
 * Extracted from `loop.ts` when it crossed the G8 400-LoC cap. These two belong together: both
 * answer "the round produced a thinking block — where does it land in the persisted conversation",
 * and the answer differs by which path closes the round.
 *
 * @internal
 */

import type { ConversationStep } from "../../types/conversation.js";
import type { LlmThinkingPart } from "../llm/types.js";
import type { LoopContext } from "./loop-context-init.js";

/**
 * theokit#122 — the round's thinking block as a conversation step.
 *
 * Shared by the two paths that can close a round: the assistant-text path and the tool_use path.
 * The tool_use path is the one that matters — a round of thinking + a tool call with NO preamble
 * text is the common Anthropic shape, and it is exactly the case the first version of this fix
 * dropped (the block stayed on the context and was persisted against the NEXT round's text).
 */
export function thinkingStep(thinking: LlmThinkingPart): ConversationStep {
  return {
    type: "thinkingMessage",
    message: {
      text: thinking.text,
      ...(thinking.signature !== undefined ? { signature: thinking.signature } : {}),
    },
  };
}

/**
 * theokit#122 — persist the block for a round that called a tool and said nothing.
 *
 * Such a round emits no assistant-text step, so without this the block is never recorded for it —
 * which is exactly how the first version of this fix let round N's signature reach round N+1.
 * No-op when the round had text (the text path already recorded it) or produced no thinking.
 */
export function recordThinkingOnSilentToolRound(
  ctx: LoopContext,
  text: string,
  thinking: LlmThinkingPart | undefined,
): void {
  if (text.length > 0 || thinking === undefined) return;
  ctx.conversation.push({
    type: "agentConversationTurn",
    turn: { steps: [thinkingStep(thinking)] },
  });
}
