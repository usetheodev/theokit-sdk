import type {
  ConversationStorageAdapter,
  StoredMessage,
} from "../../types/conversation-storage.js";
import { FileSystemConversationStorage } from "../persistence/conversation-storage-fs.js";
import { compactSessionFile, readSessionFile } from "./agent-session-store.js";

/**
 * Per-agent conversation history kept across runs (and across `Agent.resume()`
 * within the same process). Lets the fixture responder recall prior facts
 * when the user asks a follow-up question.
 *
 * Disk persistence (ADR D18 + D303): every append also lands in the configured
 * {@link ConversationStorageAdapter}. The default (no adapter, only cwd
 * supplied) writes to `<cwd>/.theokit/agents/<agentId>/messages.jsonl` via
 * {@link FileSystemConversationStorage}. Reads stay sync via the in-memory
 * cache; hydration from the adapter happens explicitly via
 * `hydrateSession(agentId, cwdOrStorage)` before the first read of a resumed
 * agent.
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

// Module-level cache so per-cwd FileSystemConversationStorage instances are
// reused across `appendSessionMessage` / `hydrateSession` calls instead of
// allocated per-message. Cleared by `clearAllSessions` for tests.
const fsAdapterByCwd = new Map<string, FileSystemConversationStorage>();

/**
 * Resolve the storage adapter for backward-compat overload.
 *
 * The public `LocalAgent` constructor today passes a `cwd: string` to all
 * session helpers. The Production-Readiness plan introduces
 * `AgentOptions.conversationStorage` which arrives as a `ConversationStorageAdapter`.
 * This helper accepts either and lazily wraps `cwd` into a cached
 * {@link FileSystemConversationStorage}.
 *
 * @internal
 */
function resolveStorage(cwdOrStorage: string | ConversationStorageAdapter): {
  adapter: ConversationStorageAdapter;
  key: string;
} {
  if (typeof cwdOrStorage !== "string") {
    // Custom adapter — keyed by object identity (`String(adapter)` collides
    // for plain objects, so we use a WeakMap-style identity counter).
    return { adapter: cwdOrStorage, key: storageKey(cwdOrStorage) };
  }
  const existing = fsAdapterByCwd.get(cwdOrStorage);
  if (existing !== undefined) {
    return { adapter: existing, key: `cwd:${cwdOrStorage}` };
  }
  const fresh = new FileSystemConversationStorage({ root: cwdOrStorage });
  fsAdapterByCwd.set(cwdOrStorage, fresh);
  return { adapter: fresh, key: `cwd:${cwdOrStorage}` };
}

const adapterIdentity = new WeakMap<object, number>();
let adapterIdentityCounter = 0;
function storageKey(adapter: ConversationStorageAdapter): string {
  let id = adapterIdentity.get(adapter as object);
  if (id === undefined) {
    id = ++adapterIdentityCounter;
    adapterIdentity.set(adapter as object, id);
  }
  return `adapter:${id}`;
}

function sessionKey(agentId: string, storageId: string): string {
  return `${storageId}::${agentId}`;
}

/**
 * Append a session message to the in-memory cache. When `cwdOrStorage` is
 * supplied, the same message is queued to the persistent storage adapter
 * (default FS at `<cwd>/.theokit/agents/<id>/messages.jsonl`).
 *
 * Writes are fire-and-forget but chained per-(agent,storage) so on-disk
 * (or on-store) order matches in-memory order. Compaction runs every
 * `COMPACTION_CHECK_INTERVAL` appends when the adapter implements `compact()`.
 *
 * @internal
 */
export function appendSessionMessage(
  agentId: string,
  message: SessionMessage,
  cwdOrStorage?: string | ConversationStorageAdapter,
): void {
  const existing = sessions.get(agentId) ?? [];
  existing.push(message);
  sessions.set(agentId, existing);
  if (cwdOrStorage === undefined) return;

  const { adapter, key: storageId } = resolveStorage(cwdOrStorage);
  const key = sessionKey(agentId, storageId);
  const stored: StoredMessage = { role: message.role, content: message.text, at: Date.now() };
  const chained = (pendingAppends.get(key) ?? Promise.resolve()).then(async () => {
    try {
      await adapter.appendMessage(agentId, stored);
      const count = (appendCounts.get(key) ?? 0) + 1;
      appendCounts.set(key, count);
      if (count % COMPACTION_CHECK_INTERVAL === 0 && adapter.compact !== undefined) {
        await adapter.compact(agentId, DEFAULT_MAX_TURNS);
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
 * Load the persisted record into the in-memory cache. Idempotent per
 * (agentId, storage) pair. Call once per agent lifecycle (e.g., from
 * `LocalAgent.initialize`) before the first read.
 *
 * Hydration uses the adapter's full storage surface but the in-memory
 * `SessionMessage` cache narrows to user/assistant roles (other roles
 * round-trip via the public `ConversationStorageAdapter` directly).
 *
 * Accepts `cwd: string` (default FS) OR a `ConversationStorageAdapter`.
 *
 * @internal
 */
export async function hydrateSession(
  agentId: string,
  cwdOrStorage: string | ConversationStorageAdapter,
): Promise<void> {
  const { adapter, key: storageId } = resolveStorage(cwdOrStorage);
  const key = sessionKey(agentId, storageId);
  if (hydratedKeys.has(key)) return;
  hydratedKeys.add(key);

  const persisted = await readPersistedForCache(adapter, agentId);
  if (persisted.length === 0) return;
  if (!sessions.has(agentId) || sessions.get(agentId)?.length === 0) {
    sessions.set(agentId, persisted);
  }
}

/**
 * Read messages from the storage adapter and narrow to the in-memory
 * `SessionMessage` shape (user/assistant only). Extracted helper to keep
 * `hydrateSession` under the cyclomatic-complexity cap.
 *
 * @internal
 */
async function readPersistedForCache(
  adapter: ConversationStorageAdapter,
  agentId: string,
): Promise<SessionMessage[]> {
  // FS adapter uses the legacy narrowed reader for zero-cost behavior.
  if (adapter instanceof FileSystemConversationStorage) {
    return readSessionFile(adapter.root, agentId);
  }
  const records = await adapter.getMessages(agentId);
  const out: SessionMessage[] = [];
  for (const r of records) {
    if (r.role === "user" || r.role === "assistant") {
      out.push({ role: r.role, text: r.content });
    }
  }
  return out;
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
 * Accepts `cwd: string` (default FS) OR a `ConversationStorageAdapter`.
 *
 * @internal
 */
export async function compactSession(
  agentId: string,
  cwdOrStorage: string | ConversationStorageAdapter,
): Promise<void> {
  const { adapter, key: storageId } = resolveStorage(cwdOrStorage);
  const key = sessionKey(agentId, storageId);
  const chained = (pendingAppends.get(key) ?? Promise.resolve()).then(async () => {
    if (adapter instanceof FileSystemConversationStorage) {
      await compactSessionFile(adapter.root, agentId, DEFAULT_MAX_TURNS);
    } else if (adapter.compact !== undefined) {
      await adapter.compact(agentId, DEFAULT_MAX_TURNS);
    }
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
  fsAdapterByCwd.clear();
}
