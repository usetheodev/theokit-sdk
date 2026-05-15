import type { AgentOptions, ModelSelection } from "../../types/agent.js";

/**
 * Process-wide agent registry. Holds the metadata needed to satisfy
 * Agent.list/Agent.get/Agent.resume across local and cloud runtimes,
 * plus the user-provided config that drives `agent.send()`.
 *
 * @internal
 */

export type AgentRuntime = "local" | "cloud";

export interface RegisteredAgent {
  agentId: string;
  runtime: AgentRuntime;
  name?: string;
  summary?: string;
  model?: ModelSelection;
  createdAt: number;
  lastModified: number;
  archived: boolean;
  options: AgentOptions;
  /** Local workspace cwd; only set when runtime is local. */
  cwd?: string;
  /** Cloud repo URLs; only set when runtime is cloud. */
  repos?: string[];
  /** Optional explicit status reported via SDKAgentInfo.status. */
  status?: "running" | "finished" | "error";
}

const agents = new Map<string, RegisteredAgent>();

export function registerAgent(agent: RegisteredAgent): void {
  agents.set(agent.agentId, agent);
}

export function getRegisteredAgent(agentId: string): RegisteredAgent | undefined {
  return agents.get(agentId);
}

export function listRegisteredAgents(runtime?: AgentRuntime): RegisteredAgent[] {
  const all = Array.from(agents.values());
  if (runtime === undefined) return all;
  return all.filter((agent) => agent.runtime === runtime);
}

export function updateRegisteredAgent(
  agentId: string,
  update: Partial<RegisteredAgent>,
): RegisteredAgent | undefined {
  const existing = agents.get(agentId);
  if (existing === undefined) return undefined;
  const updated: RegisteredAgent = {
    ...existing,
    ...update,
    lastModified: Date.now(),
  };
  agents.set(agentId, updated);
  return updated;
}

export function removeRegisteredAgent(agentId: string): boolean {
  return agents.delete(agentId);
}

export function clearAgentRegistry(): void {
  agents.clear();
}
