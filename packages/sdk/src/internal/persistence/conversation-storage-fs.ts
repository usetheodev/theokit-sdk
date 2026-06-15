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
  compactSessionFile,
  type PersistedSessionMessage,
  readAllPersistedMessages,
} from "../runtime/session/agent-session-store.js";
import { safePathJoin, sanitizeIdentifier } from "../security/index.js";

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

  async getMessages(conversationId: string): Promise<readonly StoredMessage[]> {
    const records = await readAllPersistedMessages(this.#root, conversationId);
    return records.map(toStoredMessage);
  }

  async appendMessage(conversationId: string, message: StoredMessage): Promise<void> {
    const record: PersistedSessionMessage = {
      role: message.role,
      text: message.content,
      at: message.at ?? Date.now(),
    };
    await appendAnyPersistedMessage(this.#root, conversationId, record);
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
