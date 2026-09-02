import type {
  SDKAssistantMessage,
  SDKSystemMessage,
  SDKThinkingMessage,
  SDKUserMessageEvent,
} from "../../types/messages.js";
import type { LlmContentPart, LlmMessage, LlmThinkingPart, LlmToolCallPart } from "../llm/types.js";
import type { AgentLoopInputs } from "./types.js";

/**
 * Message-builder helpers extracted from `loop.ts` (G8 file-size budget).
 * Each function shapes one canonical SDK message variant or the assistant's
 * outgoing LLM turn. Pure functions — no side effects.
 *
 * @internal
 */

export function buildSystemEvent(inputs: AgentLoopInputs, toolNames: string[]): SDKSystemMessage {
  return {
    type: "system",
    subtype: "init",
    agent_id: inputs.agentId,
    run_id: inputs.runId,
    model: inputs.model,
    tools: toolNames,
  };
}

export function buildUserEvent(inputs: AgentLoopInputs): SDKUserMessageEvent {
  return {
    type: "user",
    agent_id: inputs.agentId,
    run_id: inputs.runId,
    message: { role: "user", content: [{ type: "text", text: inputs.userMessage }] },
  };
}

export function buildAssistantEvent(inputs: AgentLoopInputs, text: string): SDKAssistantMessage {
  return {
    type: "assistant",
    agent_id: inputs.agentId,
    run_id: inputs.runId,
    message: { role: "assistant", content: [{ type: "text", text }] },
  };
}

/**
 * issue #47: the reasoning the model produced this turn, as a `thinking` SDKMessage.
 * issue #48: when the reasoning duration was measured, carry it as `thinking_duration_ms`
 * so a `Run.stream()` replay can render how long the model reasoned.
 */
export function buildThinkingEvent(
  inputs: AgentLoopInputs,
  text: string,
  thinkingDurationMs?: number,
  signature?: string,
): SDKThinkingMessage {
  const event: SDKThinkingMessage = {
    type: "thinking",
    agent_id: inputs.agentId,
    run_id: inputs.runId,
    text,
  };
  if (thinkingDurationMs !== undefined && thinkingDurationMs >= 0) {
    event.thinking_duration_ms = thinkingDurationMs;
  }
  // theokit#122 — carried so the turn can be persisted and replayed; absent for providers that
  // stream reasoning text without signing it.
  if (signature !== undefined) event.signature = signature;
  return event;
}

/**
 * theokit#122 — `thinking` is FIRST, and that ordering is a provider requirement, not a preference.
 *
 * Anthropic verifies the signed block on the next request and requires it to lead the assistant
 * message it belongs to. Omitting it (which this builder did until theokit#122's follow-up) makes
 * round 2 of any thinking + tools run fail with `400 "thinking blocks cannot be modified"` — the
 * exact failure the issue exists to remove. An unsigned block is passed through here and dropped at
 * the wire by `thinkingToWireBlock`, which is where that policy belongs.
 */
export function buildAssistantTurn(
  text: string,
  toolCalls: LlmToolCallPart[],
  thinking?: LlmThinkingPart,
): LlmMessage {
  const content: LlmContentPart[] = [];
  if (thinking !== undefined) content.push(thinking);
  if (text.length > 0) content.push({ type: "text", text });
  for (const call of toolCalls) content.push(call);
  return { role: "assistant", content };
}
