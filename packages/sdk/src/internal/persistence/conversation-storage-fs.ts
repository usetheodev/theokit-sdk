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

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  ConversationStorageAdapter,
  SessionMeta,
  SessionMetaPatch,
  StoredMessage,
} from "../../types/conversation-storage.js";
import type { ObjectiveRecord } from "../../types/objective.js";
import {
  appendAnyPersistedMessage,
  appendPersistedMessages,
  compactSessionFile,
  type PersistedSessionMessage,
  readAllPersistedMessages,
  truncateSessionTo,
} from "../runtime/session/agent-session-store.js";
import { redactSecrets, safePathJoin, sanitizeIdentifier } from "../security/index.js";
import { safeFilenameForId } from "../security/path-guard.js";
import { withFileLock } from "./file-lock.js";
import { coerceObjectiveRecord } from "./objective-coerce.js";
import { paginate } from "./pagination.js";
import { applyMetaPatch, coerceSessionMeta } from "./session-meta.js";

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

  // SE4 — session metadata persisted as a per-conversation sidecar
  // `<root>/.theokit/agents/<safeId>/session.json` (same sanitized perimeter as
  // the transcript). Kept separate from messages.jsonl so a title/tag write does
  // not rewrite the append-only log.
  #metaPath(conversationId: string): string {
    const safe = sanitizeIdentifier(conversationId, { maxLen: 128 });
    return safePathJoin(this.#root, ".theokit", "agents", safe, "session.json");
  }

  async getSessionMeta(conversationId: string): Promise<SessionMeta | undefined> {
    try {
      const raw = await readFile(this.#metaPath(conversationId), "utf8");
      // Malformed JSON throws (fail-loud, per error-handling policy); ENOENT → undefined.
      return coerceSessionMeta(JSON.parse(raw));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw cause;
    }
  }

  async setSessionMeta(conversationId: string, patch: SessionMetaPatch): Promise<void> {
    const metaPath = this.#metaPath(conversationId);
    await mkdir(dirname(metaPath), { recursive: true });
    // Serialize the read-modify-write under the same cross-process lock the
    // transcript uses — concurrent rename/tag on one session must not clobber
    // each other (was a last-write-wins TOCTOU).
    await withFileLock(metaPath, async () => {
      let current: SessionMeta = {};
      try {
        current = coerceSessionMeta(JSON.parse(await readFile(metaPath, "utf8"))) ?? {};
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      }
      const next = applyMetaPatch(current, patch);
      // T1.3 (ADR D68): redact secrets before they reach disk — a host may name a
      // session with a pasted token; same policy as the transcript writer.
      await writeFile(metaPath, redactSecrets(JSON.stringify(next)), "utf8");
    });
  }

  // SE33 — the durable objective is kept in `objective.json` beside the
  // transcript (separate from messages.jsonl + session.json). Uses the TOTAL
  // `safeFilenameForId` (not `sanitizeIdentifier`) so a caller-supplied
  // `threadId` with exotic characters (e.g. "user@example.com") hashes to a
  // deterministic dir instead of throwing — honoring the objective methods'
  // never-throw contract (ADR D6). Conforming ids pass through unchanged, so
  // the objective still sits beside the transcript for the normal case.
  #objectivePath(conversationId: string): string {
    const safe = safeFilenameForId(conversationId, { maxLen: 128 });
    return safePathJoin(this.#root, ".theokit", "agents", safe, "objective.json");
  }

  async getObjectiveRecord(conversationId: string): Promise<ObjectiveRecord | undefined> {
    try {
      const raw = await readFile(this.#objectivePath(conversationId), "utf8");
      return coerceObjectiveRecord(JSON.parse(raw));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw cause;
    }
  }

  async setObjectiveRecord(conversationId: string, record: ObjectiveRecord | null): Promise<void> {
    const path = this.#objectivePath(conversationId);
    if (record === null) {
      // Clear — idempotent (delete-of-missing is OK).
      await rm(path, { force: true });
      return;
    }
    await mkdir(dirname(path), { recursive: true });
    // Same cross-process lock + secret redaction the session-meta writer uses —
    // an objective string may embed a pasted token; never let it reach disk raw.
    await withFileLock(path, async () => {
      await writeFile(path, redactSecrets(JSON.stringify(record)), "utf8");
    });
  }

  // SE33 (HIGH-1 fix) — atomic read-modify-write: the read that feeds `mutate`
  // happens INSIDE the same file lock as the write, so two concurrent progress
  // write-backs on one thread cannot both read a stale `runsUsed` and drop turns.
  async updateObjectiveRecord(
    conversationId: string,
    mutate: (current: ObjectiveRecord | undefined) => ObjectiveRecord | null | undefined,
  ): Promise<void> {
    const path = this.#objectivePath(conversationId);
    await mkdir(dirname(path), { recursive: true });
    await withFileLock(path, async () => {
      let current: ObjectiveRecord | undefined;
      try {
        current = coerceObjectiveRecord(JSON.parse(await readFile(path, "utf8")));
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      }
      const next = mutate(current);
      if (next === undefined) return; // unchanged
      if (next === null) {
        await rm(path, { force: true });
        return;
      }
      await writeFile(path, redactSecrets(JSON.stringify(next)), "utf8");
    });
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
