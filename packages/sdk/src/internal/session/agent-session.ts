import type { SessionStore } from "../../types/session-store.js";
import {
  appendCompactBoundaryRecord,
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

/** After this many persisted turns, an append-only compact_boundary is written. */
const COMPACTION_CHECK_INTERVAL = 50;

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
 * `COMPACTION_CHECK_INTERVAL` turns an append-only `compact_boundary` is written
 * (turn-count-driven, not size-driven), surfaced via the optional `onCompact` observer.
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
      if (count % COMPACTION_CHECK_INTERVAL === 0) {
        await appendCompactBoundaryRecord(store, loc, sessionId, {
          preTokens: 0,
          trigger: "auto",
        });
        onCompact?.();
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

/** Test-only: drop every cached session and hydration marker. @internal */
export function clearAllSessions(): void {
  sessions.clear();
  hydratedKeys.clear();
  recordCounts.clear();
}
