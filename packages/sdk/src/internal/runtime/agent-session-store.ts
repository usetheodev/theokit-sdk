import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { replaceFileAtomic } from "../memory/atomic-write.js";
import { redactSecrets } from "../security/index.js";
import type { SessionMessage } from "./agent-session.js";

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

export interface PersistedSessionMessage {
  role: "user" | "assistant";
  text: string;
  at: number;
}

export function sessionFilePath(cwd: string, agentId: string): string {
  return join(cwd, ".theokit", "agents", agentId, "messages.jsonl");
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
export async function readSessionFile(cwd: string, agentId: string): Promise<SessionMessage[]> {
  const path = sessionFilePath(cwd, agentId);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return [];
  }
  const lines = raw.split("\n").filter((line) => line.length > 0);
  const messages: SessionMessage[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Partial<PersistedSessionMessage>;
      if (
        (parsed.role === "user" || parsed.role === "assistant") &&
        typeof parsed.text === "string"
      ) {
        messages.push({ role: parsed.role, text: parsed.text });
      }
    } catch {
      process.stderr.write(
        `[theokit-sdk] skipping malformed line in messages.jsonl (${agentId}): ${line.slice(0, 80)}...\n`,
      );
    }
  }
  return messages;
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
export async function compactSessionFile(
  cwd: string,
  agentId: string,
  maxTurns: number,
): Promise<void> {
  const path = sessionFilePath(cwd, agentId);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return;
  }
  const lines = raw.split("\n").filter((line) => line.length > 0);
  if (lines.length <= maxTurns * 2) return;
  const trimmed = `${lines.slice(-maxTurns).join("\n")}\n`;
  await replaceFileAtomic(path, trimmed);
}
