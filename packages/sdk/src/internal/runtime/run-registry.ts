import type { Run } from "../../types/run.js";

/**
 * Process-wide run registry indexed by run id. Lets `Agent.listRuns()` and
 * `Agent.getRun()` return the exact Run instances created by previous sends.
 *
 * @internal
 */

const runs = new Map<string, Run>();
const runsByAgent = new Map<string, string[]>();

export function registerRun(run: Run): void {
  runs.set(run.id, run);
  const existing = runsByAgent.get(run.agentId) ?? [];
  if (!existing.includes(run.id)) existing.push(run.id);
  runsByAgent.set(run.agentId, existing);
}

export function getRun(runId: string): Run | undefined {
  return runs.get(runId);
}

export function listRunsByAgent(agentId: string): Run[] {
  const ids = runsByAgent.get(agentId) ?? [];
  return ids.map((id) => runs.get(id)).filter((run): run is Run => run !== undefined);
}

export function clearRunRegistry(): void {
  runs.clear();
  runsByAgent.clear();
}
