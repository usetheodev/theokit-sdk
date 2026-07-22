import type { SessionStore } from "../../types/session-store.js";
import {
  type PersistTurnInput,
  persistTurn,
  readSessionMessages,
  type TranscriptLocation,
} from "./agent-session-store.js";

/**
 * Per-agent conversation history kept across runs (and across `Agent.resume()`
 * within the same process). Lets the fixture responder recall prior facts when
 * the user asks a follow-up question.
 *
 * SE40 — disk persistence IS the native Claude-shaped `.jsonl` transcript. The
 * in-memory cache holds the narrowed `SessionMessage[]` (user/assistant text) so
 * a send can read `priorMessages` synchronously; the whole rich turn (user +
 * assistant + tool blocks) lands on disk once per send via {@link persistTurnToTranscript}
 * (fed by `run.conversation()`). Hydration on resume reconstructs the session by
 * walking the transcript DAG (`readSessionMessages`).
 *
 * @internal
 */

// `SessionMessage` lives in `./session-types.ts` (leaf types file). Re-exported
// for back-compat with downstream importers that pulled it from here.
export type { SessionMessage } from "./session-types.js";

import type { SessionMessage } from "./session-types.js";

const sessions = new Map<string, SessionMessage[]>();
const hydratedKeys = new Set<string>();
const pendingWrites = new Map<string, Promise<void>>();
const recordCounts = new Map<string, number>();

/** The per-(cwd, agentId) transcript key for cache/hydration bookkeeping. */
function transcriptKey(cwd: string, agentId: string): string {
  return `${cwd}::${agentId}`;
}

/**
 * Append a session message to the in-memory cache only. Disk persistence for the
 * whole turn happens once per send via {@link persistTurnToTranscript}; the cache
 * feeds `priorMessages` / `onBeforeSend.previousMessageCount` synchronously.
 *
 * @internal
 */
export function appendSessionMessage(agentId: string, message: SessionMessage): void {
  const existing = sessions.get(agentId) ?? [];
  existing.push(message);
  sessions.set(agentId, existing);
}

export function getSessionMessages(agentId: string): SessionMessage[] {
  return sessions.get(agentId) ?? [];
}

/**
 * Persist a full conversation turn (user + assistant + tool blocks) to the native
 * transcript. Chained per-(agent, transcript) so on-disk order matches send order,
 * and fire-and-forget so `send()` is not blocked by disk I/O. Every
 * M50 — when the caller supplies `turn.autoCompact`, size-driven auto-compaction (usage real vs
 * the model's context window) runs in this same chain, surfaced via the optional `onCompact` observer.
 *
 * @internal
 */
export function persistTurnToTranscript(
  store: SessionStore,
  loc: TranscriptLocation,
  sessionId: string,
  turn: PersistTurnInput,
  onCompact?: () => void,
): void {
  const key = transcriptKey(loc.cwd, loc.agentId);
  const chained = (pendingWrites.get(key) ?? Promise.resolve()).then(async () => {
    try {
      await persistTurn(store, loc, sessionId, turn);
      const count = (recordCounts.get(key) ?? 0) + 1;
      recordCounts.set(key, count);
      // M50 — the 50-turn no-summary boundary stub is GONE (it silently amnesia'd the session).
      // Auto-compaction is now size-driven with a real summary: see `maybeAutoCompact` below,
      // invoked in this same write chain by the post-run lifecycle when usage is known.
      if (turn.autoCompact !== undefined) {
        const { autoCompactIfNeeded } = await import("./compact-session.js");
        const fired = await autoCompactIfNeeded({
          store,
          loc,
          sessionId,
          usageTotal: turn.autoCompact.usageTotal,
          contextWindow: turn.autoCompact.contextWindow,
          turnCount: count,
          summarize: turn.autoCompact.summarize,
        });
        if (fired) onCompact?.();
      }
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      process.stderr.write(
        `[theokit-sdk] session transcript write failed (${loc.agentId}): ${msg}\n`,
      );
    }
  });
  pendingWrites.set(
    key,
    chained.then(
      () => undefined,
      () => undefined,
    ),
  );
}

/**
 * Load the persisted transcript into the in-memory cache. Idempotent per
 * (baseDir, cwd, agentId). Call once per agent lifecycle before the first read.
 *
 * @internal
 */
export async function hydrateSession(
  agentId: string,
  loc: { store: SessionStore; cwd: string },
): Promise<void> {
  const key = transcriptKey(loc.cwd, agentId);
  if (hydratedKeys.has(key)) return;
  hydratedKeys.add(key);

  const persisted = await readSessionMessages(loc.store, agentId);
  if (persisted.length === 0) return;
  if (!sessions.has(agentId) || sessions.get(agentId)?.length === 0) {
    sessions.set(agentId, persisted);
  }
}

/**
 * Wait for all pending transcript writes to settle. Used by tests and by the
 * agent dispose path so on-disk state matches in-memory before the caller proceeds.
 *
 * @internal
 */
export async function flushSessionWrites(): Promise<void> {
  while (pendingWrites.size > 0) {
    const all = Array.from(pendingWrites.values());
    pendingWrites.clear();
    await Promise.all(all);
  }
}

export function clearSession(agentId: string): void {
  sessions.delete(agentId);
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

/**
 * M50 review F5 — run `fn` serialized on the SAME per-(cwd,agentId) write chain the per-turn
 * persistence uses, so a manual `Agent.compact` can never interleave with an in-flight turn's
 * writes (boundary landing mid-turn would orphan the turn from the replay).
 */
export function enqueueSessionWrite<T>(
  cwd: string,
  agentId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = transcriptKey(cwd, agentId);
  const prior = pendingWrites.get(key) ?? Promise.resolve();
  const result = prior.then(fn);
  pendingWrites.set(
    key,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}

/** Test-only: drop every cached session and hydration marker. @internal */
export function clearAllSessions(): void {
  sessions.clear();
  hydratedKeys.clear();
  recordCounts.clear();
  // M50 review F11 — the auto-compact attempt marks live on globalThis; tests reset them here.
  const g = globalThis as unknown as Record<symbol, Map<string, number>>;
  const sym = Symbol.for("theokit-sdk.session.auto-compact-attempts");
  g[sym]?.clear();
}
