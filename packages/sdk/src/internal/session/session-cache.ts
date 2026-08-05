import type { SessionMessage } from "./session-types.js";

/**
 * The in-memory session cache — in a LEAF module, on purpose.
 *
 * O estado e o invalidador viviam em `agent-session.ts`, e `compact-session.ts` importava
 * `invalidateSessionCache` from there — while `agent-session.ts` imported `autoCompactIfNeeded`
 * back. The cycle was broken at runtime (the return edge is a dynamic `await import()`), but the detector
 * counts the dynamic edge, and counting a dynamic import as a cycle makes the gate impossible to satisfy
 * without abandoning the canonical cycle-breaking technique.
 *
 * This state's natural owner was never `agent-session.ts`: they are two process-wide maps that both
 * modules read. Extracting them into a leaf removes the cycle under ANY detector, with no tool
 * policy and without changing a line of behavior — the same `Map`/`Set` instances remain
 * the only ones in the process, because an ES module is a singleton.
 */
export const sessions = new Map<string, SessionMessage[]>();
export const hydratedKeys = new Set<string>();

/** The per-(cwd, agentId) transcript key for cache/hydration bookkeeping. */
export function transcriptKey(cwd: string, agentId: string): string {
  return `${cwd}::${agentId}`;
}

export function invalidateSessionCache(cwd: string, agentId: string): void {
  sessions.delete(agentId);
  hydratedKeys.delete(transcriptKey(cwd, agentId));
}
