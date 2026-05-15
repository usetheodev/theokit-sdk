/**
 * Per-agent conversation history kept across runs (and across Agent.resume()
 * within the same process). Lets the fixture responder recall prior facts
 * when the user asks a follow-up question.
 *
 * @internal
 */

export interface SessionMessage {
  role: "user" | "assistant";
  text: string;
}

const sessions = new Map<string, SessionMessage[]>();

export function appendSessionMessage(agentId: string, message: SessionMessage): void {
  const existing = sessions.get(agentId) ?? [];
  existing.push(message);
  sessions.set(agentId, existing);
}

export function getSessionMessages(agentId: string): SessionMessage[] {
  return sessions.get(agentId) ?? [];
}

export function clearSession(agentId: string): void {
  sessions.delete(agentId);
}
