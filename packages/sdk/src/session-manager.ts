/**
 * SE4 — session-management surface over {@link ConversationStorageAdapter}.
 *
 * `createSessionManager(storage)` binds the four session operations
 * (list / get / rename / tag) to a storage adapter — the same instance a host
 * passed to `Agent.create({ conversationStorage })`. It derives LIGHT metadata
 * (firstPrompt, lastModified, messageCount) from the transcript, persists
 * title/tag via the adapter's optional `setSessionMeta`, and degrades to a typed
 * `{ supported: false }` result for adapters that cannot list or write metadata —
 * never a throw-on-every-call.
 *
 * Composition-LEGO precedent: mirrors `createSquad` / `createAgentFactory` — a
 * thin factory over an existing primitive, no new orchestration.
 *
 * @public
 */

import type { ConversationStorageAdapter, StoredMessage } from "./types/conversation-storage.js";
import type {
  SessionCapabilityResult,
  SessionListOptions,
  SessionManager,
  SessionSummary,
} from "./types/session.js";

/** Max chars of the first prompt used as a fallback `summary` preview. */
const SUMMARY_PREVIEW_MAX = 80;

/**
 * Build a {@link SessionManager} bound to `storage`.
 *
 * @public
 */
function createSessionManager(storage: ConversationStorageAdapter): SessionManager {
  return {
    async listSessions(
      opts?: SessionListOptions,
    ): Promise<SessionCapabilityResult<readonly SessionSummary[]>> {
      if (typeof storage.listConversationIds !== "function") {
        return {
          supported: false,
          reason: "storage adapter does not support listing conversations (listConversationIds)",
        };
      }
      const ids = await storage.listConversationIds();
      if (ids === undefined) {
        return {
          supported: false,
          reason:
            "storage adapter reported listing as unsupported (listConversationIds → undefined)",
        };
      }
      const windowed = windowIds(ids, opts);
      const summaries: SessionSummary[] = [];
      for (const id of windowed) {
        summaries.push(await buildSummary(storage, id));
      }
      return { supported: true, value: summaries };
    },

    getSessionMessages(
      id: string,
      opts?: { offset?: number; limit?: number },
    ): Promise<readonly StoredMessage[]> {
      return storage.getMessages(id, opts);
    },

    async renameSession(id: string, title: string): Promise<SessionCapabilityResult<void>> {
      if (typeof storage.setSessionMeta !== "function") {
        return unsupportedWrite();
      }
      await storage.setSessionMeta(id, { title });
      return { supported: true, value: undefined };
    },

    async tagSession(id: string, tag: string | null): Promise<SessionCapabilityResult<void>> {
      if (typeof storage.setSessionMeta !== "function") {
        return unsupportedWrite();
      }
      await storage.setSessionMeta(id, { tag });
      return { supported: true, value: undefined };
    },
  };
}

function unsupportedWrite(): SessionCapabilityResult<void> {
  return {
    supported: false,
    reason: "storage adapter does not support writing session metadata (setSessionMeta)",
  };
}

/** Apply `{ offset, limit }` windowing to the enumerated ids. */
function windowIds(ids: readonly string[], opts?: SessionListOptions): readonly string[] {
  const start = opts?.offset !== undefined && opts.offset > 0 ? opts.offset : 0;
  const rawLimit = opts?.limit;
  // A non-positive limit means "nothing" — never let `slice(start, negative)`
  // silently return a suffix window (surprising, off-by-one-prone).
  if (rawLimit !== undefined && rawLimit <= 0) return [];
  const end = rawLimit !== undefined ? start + rawLimit : undefined;
  return ids.slice(start, end);
}

/** Derive one session's light metadata from its transcript + stored meta. */
async function buildSummary(
  storage: ConversationStorageAdapter,
  id: string,
): Promise<SessionSummary> {
  const messages = await storage.getMessages(id);
  const firstUser = messages.find((m) => m.role === "user")?.content;
  // Treat an empty-string first prompt as "no prompt" — `firstPrompt` is
  // documented as "the first user message, when present", so an empty content
  // must not leak `firstPrompt: ""` into the summary.
  const firstPrompt = firstUser !== undefined && firstUser.length > 0 ? firstUser : undefined;
  const lastModified = deriveLastModified(messages);
  const meta =
    typeof storage.getSessionMeta === "function" ? await storage.getSessionMeta(id) : undefined;
  const title = meta?.title;
  const tag = meta?.tag;
  const summary = title ?? previewOf(firstPrompt);
  return {
    id,
    messageCount: messages.length,
    ...(firstPrompt !== undefined ? { firstPrompt } : {}),
    ...(lastModified !== undefined ? { lastModified } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(tag !== undefined ? { tag } : {}),
    ...(summary !== undefined ? { summary } : {}),
  };
}

/** Largest `at` across the transcript, or undefined when none is stamped. */
function deriveLastModified(messages: readonly StoredMessage[]): number | undefined {
  let last: number | undefined;
  for (const m of messages) {
    if (m.at !== undefined && (last === undefined || m.at > last)) last = m.at;
  }
  return last;
}

/** A short single-line preview of the first prompt for the `summary` fallback. */
function previewOf(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length === 0) return undefined;
  return oneLine.length > SUMMARY_PREVIEW_MAX
    ? `${oneLine.slice(0, SUMMARY_PREVIEW_MAX - 1)}…`
    : oneLine;
}

/** SE36 — `Session.create` replaces `createSessionManager` (ADR 0015). @public */
export class Session {
  private constructor() {}
  static create(storage: ConversationStorageAdapter): SessionManager {
    return createSessionManager(storage);
  }
}
