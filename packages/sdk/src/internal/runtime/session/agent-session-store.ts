import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import { replaceFileAtomic } from "../../persistence/atomic-write.js";
import { withFileLock } from "../../persistence/file-lock.js";
import { redactSecrets, safePathJoin, sanitizeIdentifier } from "../../security/index.js";
import type { SessionMessage } from "./session-types.js";

/**
 * Persistent session-message storage (ADR D18).
 *
 * One append-only JSONL file per agent at
 * `<cwd>/.theokit/agents/<agentId>/messages.jsonl`. Each line is a
 * `PersistedSessionMessage` record. JSONL is naturally append-friendly,
 * crash-safe at line granularity (EC-7), and avoids global lock contention
 * by partitioning per-agent.
 *
 * @internal
 */

/**
 * Persisted message shape on disk. Role is the broader 5-role union after
 * Production-Readiness EC-10 (forward-compat with tool-shaped messages flowing
 * through `ConversationStorageAdapter.appendMessage`). Legacy JSONL files
 * containing only user/assistant continue to parse — `readSessionFile`
 * filters unknown roles defensively.
 */
export interface PersistedSessionMessage {
  role: "user" | "assistant" | "system" | "tool_call" | "tool_result";
  text: string;
  at: number;
}

const VALID_ROLES = new Set<PersistedSessionMessage["role"]>([
  "user",
  "assistant",
  "system",
  "tool_call",
  "tool_result",
]);

export function sessionFilePath(cwd: string, agentId: string): string {
  // ADRs D79-D81: validate agentId grammar + safe-join. Agent IDs (local
  // `agent-<uuid>` / cloud `bc-<uuid>`) fit the strict grammar; legacy IDs
  // would throw `invalid_identifier` here, surfacing migration needs early
  // rather than silently joining outside `.theokit/agents/`.
  const safe = sanitizeIdentifier(agentId, { maxLen: 128 });
  return safePathJoin(cwd, ".theokit", "agents", safe, "messages.jsonl");
}

/**
 * Append one record. Creates the per-agent directory lazily. The caller is
 * responsible for serialization within an agent — Phase 2's send mutex
 * (`agent-send:${agentId}`) gives that guarantee for real send paths; the
 * in-process `agent-session.ts` chains its own per-key promise queue for
 * fire-and-forget appends outside the send mutex.
 *
 * @internal
 */
export async function appendToSessionFile(
  cwd: string,
  agentId: string,
  message: SessionMessage,
): Promise<void> {
  const path = sessionFilePath(cwd, agentId);
  const record: PersistedSessionMessage = {
    role: message.role,
    text: message.text,
    at: Date.now(),
  };
  await mkdir(dirname(path), { recursive: true });
  // EC-6: JSON.stringify handles newlines, tabs, and quote escapes inside
  // text so a multi-line message stays one JSONL line on disk.
  // T1.3 (ADR D68): pass the serialized record through `redactSecrets` so
  // tool results containing `env | grep API` style output, or assistant
  // text that echoes a user-provided key, never persist verbatim on disk.
  await appendFile(path, `${redactSecrets(JSON.stringify(record))}\n`, "utf8");
}

/**
 * Read the JSONL file from disk. Returns `[]` when the file does not exist.
 * Malformed lines (EC-7: half-written last line on crash, or any other
 * unparseable record) are skipped with a stderr warning — never thrown.
 *
 * @internal
 */
async function readJsonlLines(cwd: string, agentId: string): Promise<string[]> {
  const path = sessionFilePath(cwd, agentId);
  try {
    const raw = await readFile(path, "utf8");
    return raw.split("\n").filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

function warnMalformed(agentId: string, line: string): void {
  process.stderr.write(
    `[theokit-sdk] skipping malformed line in messages.jsonl (${agentId}): ${line.slice(0, 80)}...\n`,
  );
}

/**
 * M3 #62 — map one persisted line to a hydrated `SessionMessage`, or `undefined`
 * when the line carries no usable text. Tool turns are folded into assistant-role
 * context (see `readSessionFile`). Extracted to keep `readSessionFile` under the
 * complexity budget.
 */
function hydrateSessionLine(parsed: Partial<PersistedSessionMessage>): SessionMessage | undefined {
  if (typeof parsed.text !== "string" || parsed.role === undefined) return undefined;
  if (parsed.role === "user" || parsed.role === "assistant") {
    return { role: parsed.role, text: parsed.text };
  }
  if (parsed.role === "tool_call" || parsed.role === "tool_result") {
    const label = parsed.role === "tool_call" ? "tool call" : "tool result";
    return { role: "assistant", text: `[${label}] ${parsed.text}` };
  }
  return undefined;
}

export async function readSessionFile(cwd: string, agentId: string): Promise<SessionMessage[]> {
  const lines = await readJsonlLines(cwd, agentId);
  const messages: SessionMessage[] = [];
  for (const line of lines) {
    // M3 #62 — resume was LOSSY: tool turns were silently dropped from the hydrated
    // context, so a resumed agent forgot every tool it had run. `hydrateSessionLine`
    // now folds them into assistant-role context so the tool history survives resume.
    // (Exact tool_use/tool_result LLM-block reconstruction for mid-call resume needs
    // persisted tool-use ids — a schema change deferred; see docs.md.)
    try {
      const msg = hydrateSessionLine(JSON.parse(line) as Partial<PersistedSessionMessage>);
      if (msg !== undefined) messages.push(msg);
    } catch {
      warnMalformed(agentId, line);
    }
  }
  return messages;
}

/**
 * Read EVERY persisted record (any role) — used by the
 * {@link ConversationStorageAdapter} surface that exposes the full StoredMessage
 * shape. Same defensive parsing as `readSessionFile` but returns the broader
 * `PersistedSessionMessage[]` without narrowing to user/assistant.
 *
 * @internal
 */
export async function readAllPersistedMessages(
  cwd: string,
  agentId: string,
): Promise<PersistedSessionMessage[]> {
  const lines = await readJsonlLines(cwd, agentId);
  const messages: PersistedSessionMessage[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Partial<PersistedSessionMessage>;
      if (
        parsed.role !== undefined &&
        VALID_ROLES.has(parsed.role) &&
        typeof parsed.text === "string"
      ) {
        messages.push({
          role: parsed.role,
          text: parsed.text,
          at: typeof parsed.at === "number" ? parsed.at : Date.now(),
        });
      }
    } catch {
      warnMalformed(agentId, line);
    }
  }
  return messages;
}

/**
 * Append a persisted record carrying an arbitrary role (EC-10 expansion).
 *
 * @internal
 */
export async function appendAnyPersistedMessage(
  cwd: string,
  agentId: string,
  record: PersistedSessionMessage,
): Promise<void> {
  await appendPersistedMessages(cwd, agentId, [record]);
}

/**
 * M2 #63 — batch-append a whole conversation turn (user + assistant + N tool
 * results) in ONE write under a cross-process file lock. Replaces the pre-M2
 * per-message `mkdir` + `appendFile` cycle (N opens per turn) with a single
 * `mkdir` + single `appendFile`, and closes the cross-process race: two Node
 * processes sharing a cwd (CLI + daemon, parallel workers) can no longer tear a
 * >4KB line or interleave lines. `withFileLock` uses `proper-lockfile` when
 * installed (cross-process) and falls back to an in-process mutex otherwise.
 * A no-op for an empty batch.
 *
 * @internal
 */
export async function appendPersistedMessages(
  cwd: string,
  agentId: string,
  records: readonly PersistedSessionMessage[],
): Promise<void> {
  if (records.length === 0) return;
  const path = sessionFilePath(cwd, agentId);
  const payload = records.map((r) => `${redactSecrets(JSON.stringify(r))}\n`).join("");
  const dir = dirname(path);
  // mkdir BEFORE the lock: withFileLock's companion `<path>.lock` needs the parent
  // dir to exist. One mkdir per turn (batch) replaces the pre-M2 per-message mkdir.
  // Retry ONCE on ENOENT: a fire-and-forget append can race a concurrent removal
  // of the session dir (e.g. a test tearing down `.theokit/` while an async append
  // is still in flight); the lock's mkdir-based `.lock` then fails mid-acquire.
  // The `written` guard makes the retry idempotent — a post-write ENOENT (e.g. from
  // the lock RELEASE after appendFile already succeeded) must NOT re-append and
  // duplicate the turn; only a pre-write failure retries. A second ENOENT propagates.
  let written = false;
  const attempt = async (): Promise<void> => {
    await mkdir(dir, { recursive: true });
    await withFileLock(path, async () => {
      await appendFile(path, payload, "utf8");
      written = true;
    });
  };
  try {
    await attempt();
  } catch (cause) {
    if (written || (cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    await attempt();
  }
}

/**
 * Trim the JSONL file to the most recent `maxTurns` records when it grows
 * past 2x that threshold. EC-2: serialization with concurrent appends is the
 * caller's responsibility — `agent-session.ts` chains both `appendSessionMessage`
 * and `compactSession` through a single per-(agent, cwd) promise queue, so
 * the read+rename window here is race-free in practice.
 *
 * Reentering `withCwdMutex("agent-send:...")` here would deadlock with the
 * Phase 2 send wrapper (same key, non-reentrant lock), which is why the
 * shared promise queue in `agent-session.ts` is the canonical serializer.
 *
 * @internal
 */
/**
 * M2 #63 — run a locked read → transform → atomic-rewrite over a session JSONL.
 * Reads the non-empty lines under the SAME cross-process lock as
 * `appendPersistedMessages` (so the read→rewrite window can never drop a line a
 * concurrent process appends), passes them to `transform`, and atomically writes
 * the result — unless `transform` returns `undefined` (no-op). Shared by
 * compaction (`compactSessionFile`) and truncation (`truncateSessionTo`) — the
 * lock/read/split/rewrite skeleton is identical (DRY).
 *
 * @internal
 */
async function rewriteLockedSession(
  path: string,
  transform: (lines: string[]) => string | undefined,
): Promise<void> {
  await withFileLock(path, async () => {
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      return;
    }
    const lines = raw.split("\n").filter((line) => line.length > 0);
    const next = transform(lines);
    if (next === undefined) return;
    await replaceFileAtomic(path, next);
  });
}

export async function compactSessionFile(
  cwd: string,
  agentId: string,
  maxTurns: number,
): Promise<void> {
  const path = sessionFilePath(cwd, agentId);
  // Nothing to compact if the log does not exist yet — and locking a missing
  // file's (missing) dir would fail the lock's own `.lock` mkdir. Pre-check
  // OUTSIDE the lock (M2 #63).
  if (!existsSync(path)) return;
  await rewriteLockedSession(path, (lines) =>
    lines.length <= maxTurns * 2 ? undefined : `${lines.slice(-maxTurns).join("\n")}\n`,
  );
}

/**
 * M3 #67 — revert a session transcript back to the first `keepCount` records
 * ("undo the last turn(s)"), rewriting the JSONL atomically under the same
 * cross-process lock as append/compact. `keepCount <= 0` empties the transcript;
 * `keepCount >= length` is a no-op. Returns the number of records kept so the
 * caller can prune its in-memory cache to match. Transcript-only — git-backed
 * workspace restore is a separate optional primitive.
 *
 * @internal
 */
export async function truncateSessionTo(
  cwd: string,
  agentId: string,
  keepCount: number,
): Promise<number> {
  const path = sessionFilePath(cwd, agentId);
  if (!existsSync(path)) return 0;
  let kept = 0;
  await rewriteLockedSession(path, (lines) => {
    const keep = Math.max(0, Math.min(keepCount, lines.length));
    kept = keep;
    if (keep === lines.length) return undefined; // no-op
    return keep === 0 ? "" : `${lines.slice(0, keep).join("\n")}\n`;
  });
  return kept;
}
