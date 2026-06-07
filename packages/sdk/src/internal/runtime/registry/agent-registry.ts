import type { AgentRuntime, RegisteredAgent } from "./agent-registry-contract.js";
import { fromSerialized, loadRegistry, saveRegistry } from "./agent-registry-store.js";

/**
 * Process-wide agent registry. Holds the metadata needed to satisfy
 * Agent.list/Agent.get/Agent.resume across local and cloud runtimes,
 * plus the user-provided config that drives `agent.send()`.
 *
 * Write-through to disk per ADR D17: every mutation schedules a coalesced
 * save to `<cwd>/.theokit/agents/registry.json`. Reads stay sync; the public
 * `Agent.resume` / `Agent.list` / `Agent.get` entry points hydrate from disk
 * lazily via `hydrateRegistryFromDisk`.
 *
 * **T3.1 of plan `arch-review-fixes-2026-06-06` (ADR D431):** the shared
 * `AgentRuntime` and `RegisteredAgent` types are now defined in
 * `agent-registry-contract.ts` (a leaf types file) and re-exported here for
 * back-compat with downstream code. The store layer (`agent-registry-store.ts`)
 * imports the types from the contract too, breaking the previous
 * runtime↔store cycle.
 *
 * @internal
 */

// Re-exported for back-compat — consumers that historically imported these
// from `./agent-registry.js` keep working. New code SHOULD import from
// `./agent-registry-contract.js` directly.
export type { AgentRuntime, RegisteredAgent };

const agents = new Map<string, RegisteredAgent>();
const hydratedCwds = new Set<string>();
const pendingSaves = new Map<string, Promise<void>>();
const dirtyCwds = new Set<string>();

function resolveRegistryCwd(agent: Pick<RegisteredAgent, "cwd">): string {
  return agent.cwd ?? process.cwd();
}

function snapshotForCwd(cwd: string): Record<string, RegisteredAgent> {
  const snapshot: Record<string, RegisteredAgent> = {};
  for (const agent of agents.values()) {
    if (resolveRegistryCwd(agent) === cwd) {
      snapshot[agent.agentId] = agent;
    }
  }
  return snapshot;
}

/**
 * Coalesce burst writes per-cwd: if a save is already pending, the new
 * mutation rides on it (the pending save picks up the latest in-memory state
 * via `snapshotForCwd`).
 *
 * @internal
 */
function scheduleSaveForCwd(cwd: string): Promise<void> {
  // Always mark dirty so a save already in flight will re-loop and pick up
  // this mutation. Without this, two synchronous registerAgent calls would
  // coalesce into ONE save whose snapshot only captured the first agent —
  // the second mutation's data would silently drop off disk.
  dirtyCwds.add(cwd);
  const existing = pendingSaves.get(cwd);
  if (existing !== undefined) return existing;
  const promise = (async () => {
    try {
      while (dirtyCwds.has(cwd)) {
        dirtyCwds.delete(cwd);
        // Yield once so the in-flight microtask burst (registerAgent +
        // updateRegisteredAgent calls fired in the same tick) all commit
        // their `agents.set` before we snapshot.
        await Promise.resolve();
        await saveRegistry(cwd, snapshotForCwd(cwd));
        // Loop guard: if a mutation arrived during saveRegistry's await,
        // dirtyCwds.has(cwd) is true again — go around for another save.
      }
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      process.stderr.write(`[theokit-sdk] registry persist failed (${cwd}): ${msg}\n`);
    } finally {
      pendingSaves.delete(cwd);
    }
  })();
  pendingSaves.set(cwd, promise);
  return promise;
}

export function registerAgent(agent: RegisteredAgent): void {
  agents.set(agent.agentId, agent);
  void scheduleSaveForCwd(resolveRegistryCwd(agent));
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
  void scheduleSaveForCwd(resolveRegistryCwd(updated));
  return updated;
}

export function removeRegisteredAgent(agentId: string): boolean {
  const existing = agents.get(agentId);
  const removed = agents.delete(agentId);
  if (removed && existing !== undefined) {
    void scheduleSaveForCwd(resolveRegistryCwd(existing));
  }
  return removed;
}

export function clearAgentRegistry(): void {
  agents.clear();
  hydratedCwds.clear();
}

/**
 * Lazily load the persisted registry for `cwd` into the in-memory Map. Skips
 * if this cwd has already been hydrated in this process. Disk-only entries
 * win over the empty in-memory state; in-memory entries (already-registered
 * agents) are never overwritten by hydration.
 *
 * @internal
 */
export async function hydrateRegistryFromDisk(cwd: string): Promise<void> {
  if (hydratedCwds.has(cwd)) return;
  hydratedCwds.add(cwd);
  const persisted = await loadRegistry(cwd);
  for (const [id, entry] of Object.entries(persisted)) {
    if (!agents.has(id)) {
      agents.set(id, fromSerialized(entry));
    }
  }
}

/**
 * Invalidate the hydration cache for `cwd` (or all cwds when omitted). Forces
 * the next `hydrateRegistryFromDisk(cwd)` to re-read from disk. Test-only.
 *
 * @internal
 */
export function invalidateRegistryHydration(cwd?: string): void {
  if (cwd !== undefined) hydratedCwds.delete(cwd);
  else hydratedCwds.clear();
}

/**
 * Wait for all pending registry saves to complete. Used by tests and by the
 * agent dispose path to guarantee on-disk state matches the in-memory state
 * before the caller continues.
 *
 * @internal
 */
export async function flushRegistrySaves(cwd?: string): Promise<void> {
  if (cwd !== undefined) {
    await (pendingSaves.get(cwd) ?? Promise.resolve());
    return;
  }
  while (pendingSaves.size > 0) {
    await Promise.all(Array.from(pendingSaves.values()));
  }
}
