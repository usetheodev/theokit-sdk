import { globalSingleton } from "../global-singleton.js";
import type { SessionMessage } from "./types.js";

/**
 * The in-memory session cache — in a LEAF module, on purpose.
 *
 * The state and the invalidator lived in `agent-session.ts`, and `compact-session.ts` imported
 * `invalidateSessionCache` from there — while `agent-session.ts` imported `autoCompactIfNeeded`
 * back. The cycle was broken at runtime (the return edge is a dynamic `await import()`), but the detector
 * counts the dynamic edge, and counting a dynamic import as a cycle makes the gate impossible to satisfy
 * without abandoning the canonical cycle-breaking technique.
 *
 * This state's natural owner was never `agent-session.ts`: they are two process-wide maps that both
 * modules read. Extracting them into a leaf removes the cycle under ANY detector, with no tool
 * policy and without changing a line of behavior.
 *
 * THE CLAIM THAT USED TO CLOSE THIS PARAGRAPH WAS FALSE. It said the same `Map`/`Set` instances
 * remain the only ones in the process "because an ES module is a singleton". A module is a singleton
 * per MODULE INSTANCE, and `internal/global-singleton.ts` exists in this repository, in writing, to
 * refute exactly that: a package loaded twice — two copies in `node_modules`, ESM and CJS side by
 * side, a monorepo with distinct versions — evaluates the module twice and produces two Maps that
 * cannot see each other. Both now go through the helper, which keys on the global symbol registry.
 */
export const sessions = globalSingleton(
  "theokit-sdk.session.cache.messages",
  () => new Map<string, SessionMessage[]>(),
);
export const hydratedKeys = globalSingleton(
  "theokit-sdk.session.cache.hydrated",
  () => new Set<string>(),
);

/** The per-(cwd, agentId) transcript key for cache/hydration bookkeeping. */
export function transcriptKey(cwd: string, agentId: string): string {
  return `${cwd}::${agentId}`;
}

/**
 * M50 review F1 — drop BOTH the message cache and the hydration marker so the NEXT send re-hydrates
 * from disk. Without this, a compaction only helps after a process restart: the live process keeps
 * sending the full pre-compact history (the cache is read synchronously by every send).
 */
export function invalidateSessionCache(cwd: string, agentId: string): void {
  sessions.delete(agentId);
  hydratedKeys.delete(transcriptKey(cwd, agentId));
}
