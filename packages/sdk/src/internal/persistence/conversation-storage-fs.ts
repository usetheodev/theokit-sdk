/**
 * Filesystem-backed implementation of {@link ConversationStorageAdapter}
 * (Production-Readiness #1, ADR D304).
 *
 * Default adapter when `AgentOptions.conversationStorage` is not provided.
 * Writes append-only JSONL to `<root>/.theokit/agents/<safeId>/messages.jsonl`,
 * preserving the pre-D303 byte-identical behavior (redaction D68 + JSONL
 * line granularity).
 *
 * Path safety: every conversationId flows through `sanitizeIdentifier` +
 * `safePathJoin` before touching disk. `deleteConversation` re-applies the
 * guard (EC-1) — without this the new `rm -rf` would escape via traversal.
 *
 * Listing: `listConversationIds` catches ENOENT (EC-2) so first-run deploys
 * without any `.theokit/agents/` directory return `[]` instead of crashing.
 *
 * @public
 */

import { readdir, rm } from "node:fs/promises";

import type {
  ConversationStorageAdapter,
  StoredMessage,
} from "../../types/conversation-storage.js";
import {
  appendAnyPersistedMessage,
  appendPersistedMessages,
  compactSessionFile,
  type PersistedSessionMessage,
  readAllPersistedMessages,
  truncateSessionTo,
} from "../runtime/session/agent-session-store.js";
import { safePathJoin, sanitizeIdentifier } from "../security/index.js";
import { paginate } from "./pagination.js";

export interface FileSystemConversationStorageOptions {
  /** Root directory under which `.theokit/agents/<id>/` lives. Defaults to `process.cwd()`. */
  root?: string;
}

export class FileSystemConversationStorage implements ConversationStorageAdapter {
  readonly #root: string;

  constructor(opts: FileSystemConversationStorageOptions = {}) {
    this.#root = opts.root ?? process.cwd();
  }

  /** Exposed for tests + diagnostics. The path is sanitized at use sites. */
  get root(): string {
    return this.#root;
  }

  async getMessages(
    conversationId: string,
    opts?: { offset?: number; limit?: number },
  ): Promise<readonly StoredMessage[]> {
    const records = await readAllPersistedMessages(this.#root, conversationId);
    const all = records.map(toStoredMessage);
    // M2 #63 — bounded window. JSONL has no index, so the read is still O(N)
    // (a SQLite backend would give a true indexed read); the API bounds the
    // materialized RESULT so a caller need not hold the whole history.
    return paginate(all, opts);
  }

  async appendMessage(conversationId: string, message: StoredMessage): Promise<void> {
    await appendAnyPersistedMessage(this.#root, conversationId, toRecord(message));
  }

  async appendMessages(conversationId: string, messages: readonly StoredMessage[]): Promise<void> {
    // M2 #63 — one locked appendFile for the whole turn (one open, not N).
    await appendPersistedMessages(this.#root, conversationId, messages.map(toRecord));
  }

  async truncateConversation(conversationId: string, keepCount: number): Promise<number> {
    // M3 #67 — atomic transcript revert under the shared file lock.
    return truncateSessionTo(this.#root, conversationId, keepCount);
  }

  async deleteConversation(conversationId: string): Promise<void> {
    // EC-1: re-apply path-guard. `sanitizeIdentifier` + `safePathJoin` reject
    // traversal attempts BEFORE we hand a string to `rm({ recursive: true })`.
    // Without this, `deleteConversation("../../tmp")` would escape the
    // sanitized perimeter that `sessionFilePath` enforces for appends.
    const safe = sanitizeIdentifier(conversationId, { maxLen: 128 });
    const dirPath = safePathJoin(this.#root, ".theokit", "agents", safe);
    await rm(dirPath, { recursive: true, force: true });
  }

  async deleteScope(prefix: string): Promise<number> {
    // M3 #62 — prune a whole session scope (e.g. "temp:") in one call.
    const ids = await this.listConversationIds();
    const matching = ids.filter((id) => id.startsWith(prefix));
    for (const id of matching) await this.deleteConversation(id);
    return matching.length;
  }

  async listConversationIds(opts: { limit?: number } = {}): Promise<readonly string[]> {
    // EC-2: ENOENT swallowed — projeto novo (no `.theokit/agents/` yet)
    // returns `[]` instead of crashing the caller (SIGTERM handlers, telemetry
    // sweeps, etc.).
    const agentsRoot = safePathJoin(this.#root, ".theokit", "agents");
    let entries: string[];
    try {
      entries = await readdir(agentsRoot);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw cause;
    }
    if (opts.limit !== undefined) return entries.slice(0, opts.limit);
    return entries;
  }

  async compact(conversationId: string, maxTurns: number): Promise<void> {
    await compactSessionFile(this.#root, conversationId, maxTurns);
  }

  async dispose(): Promise<void> {
    // FS adapter has no long-lived handles. No-op for symmetry.
  }
}

function toStoredMessage(record: PersistedSessionMessage): StoredMessage {
  return {
    role: record.role,
    content: record.text,
    at: record.at,
  };
}

function toRecord(message: StoredMessage): PersistedSessionMessage {
  return { role: message.role, text: message.content, at: message.at ?? Date.now() };
}
