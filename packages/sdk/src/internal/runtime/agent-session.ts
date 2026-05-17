import { appendToSessionFile, compactSessionFile, readSessionFile } from "./agent-session-store.js";

/**
 * Per-agent conversation history kept across runs (and across `Agent.resume()`
 * within the same process). Lets the fixture responder recall prior facts
 * when the user asks a follow-up question.
 *
 * Disk persistence (ADR D18): when a `cwd` is supplied, every append also
 * lands in `<cwd>/.theokit/agents/<agentId>/messages.jsonl`. Reads stay sync
 * via the in-memory cache; hydration from disk happens explicitly via
 * `hydrateSession(agentId, cwd)` before the first read of a resumed agent.
 *
 * @internal
 */

export interface SessionMessage {
  role: "user" | "assistant";
  text: string;
}

const DEFAULT_MAX_TURNS = 200;
const COMPACTION_CHECK_INTERVAL = 50;

const sessions = new Map<string, SessionMessage[]>();
const hydratedKeys = new Set<string>();
const pendingAppends = new Map<string, Promise<void>>();
const appendCounts = new Map<string, number>();

function sessionKey(agentId: string, cwd: string): string {
  return `${cwd}::${agentId}`;
}

export function appendSessionMessage(agentId: string, message: SessionMessage, cwd?: string): void {
  const existing = sessions.get(agentId) ?? [];
  existing.push(message);
  sessions.set(agentId, existing);
  if (cwd === undefined) return;
  // Disk persistence is fire-and-forget but chained per-(agent,cwd) so writes
  // hit disk in the same order they entered the in-memory cache. Compaction
  // runs every COMPACTION_CHECK_INTERVAL appends and uses its own mutex to
  // serialize with the parent send (EC-2).
  const key = sessionKey(agentId, cwd);
  const chained = (pendingAppends.get(key) ?? Promise.resolve()).then(async () => {
    try {
      await appendToSessionFile(cwd, agentId, message);
      const count = (appendCounts.get(key) ?? 0) + 1;
      appendCounts.set(key, count);
      if (count % COMPACTION_CHECK_INTERVAL === 0) {
        await compactSessionFile(cwd, agentId, DEFAULT_MAX_TURNS);
      }
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      process.stderr.write(`[theokit-sdk] session append failed (${agentId}): ${msg}\n`);
    }
  });
  pendingAppends.set(
    key,
    chained.then(
      () => undefined,
      () => undefined,
    ),
  );
}

export function getSessionMessages(agentId: string): SessionMessage[] {
  return sessions.get(agentId) ?? [];
}

/**
 * Load the persisted JSONL into the in-memory cache. Idempotent per
 * (agentId, cwd) pair. Call once per agent lifecycle (e.g., from
 * `LocalAgent.initialize`) before the first read.
 *
 * @internal
 */
export async function hydrateSession(agentId: string, cwd: string): Promise<void> {
  const key = sessionKey(agentId, cwd);
  if (hydratedKeys.has(key)) return;
  hydratedKeys.add(key);
  const persisted = await readSessionFile(cwd, agentId);
  if (persisted.length === 0) return;
  // Merge: existing in-memory wins (it represents writes that have not yet
  // flushed to disk in this process). Disk records only fill an empty cache.
  if (!sessions.has(agentId) || sessions.get(agentId)?.length === 0) {
    sessions.set(agentId, persisted);
  }
}

/**
 * Wait for all pending disk appends to settle. Used by tests and by the
 * agent dispose path so on-disk state matches in-memory before the caller
 * proceeds.
 *
 * @internal
 */
export async function flushSessionWrites(): Promise<void> {
  while (pendingAppends.size > 0) {
    const all = Array.from(pendingAppends.values());
    pendingAppends.clear();
    await Promise.all(all);
  }
}

/**
 * Force-trigger compaction for one agent regardless of the append-count
 * threshold. Used by tests and by `LocalAgent.dispose` so a long-lived
 * conversation does not leave 10k stale lines on disk after the process
 * shuts down.
 *
 * EC-2: chains through the same per-(agent, cwd) promise queue as
 * `appendSessionMessage` so the read+rename window can never overlap a
 * concurrent append.
 *
 * @internal
 */
export async function compactSession(agentId: string, cwd: string): Promise<void> {
  const key = sessionKey(agentId, cwd);
  const chained = (pendingAppends.get(key) ?? Promise.resolve()).then(async () => {
    await compactSessionFile(cwd, agentId, DEFAULT_MAX_TURNS);
  });
  pendingAppends.set(
    key,
    chained.then(
      () => undefined,
      () => undefined,
    ),
  );
  await chained;
}

export function clearSession(agentId: string): void {
  sessions.delete(agentId);
}

/** Test-only: drop every cached session and hydration marker. @internal */
export function clearAllSessions(): void {
  sessions.clear();
  hydratedKeys.clear();
  appendCounts.clear();
}
