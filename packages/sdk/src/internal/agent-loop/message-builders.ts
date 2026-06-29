import type {
  SDKAssistantMessage,
  SDKSystemMessage,
  SDKThinkingMessage,
  SDKUserMessageEvent,
} from "../../types/messages.js";
import type { LlmContentPart, LlmMessage, LlmToolCallPart } from "../llm/types.js";
import type { AgentLoopInputs } from "./loop-types.js";

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

/** issue #47: the reasoning the model produced this turn, as a `thinking` SDKMessage. */
export function buildThinkingEvent(inputs: AgentLoopInputs, text: string): SDKThinkingMessage {
  return {
    type: "thinking",
    agent_id: inputs.agentId,
    run_id: inputs.runId,
    text,
  };
}

export function buildAssistantTurn(text: string, toolCalls: LlmToolCallPart[]): LlmMessage {
  const content: LlmContentPart[] = [];
  if (text.length > 0) content.push({ type: "text", text });
  for (const call of toolCalls) content.push(call);
  return { role: "assistant", content };
}
