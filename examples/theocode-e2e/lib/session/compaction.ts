import type Database from "better-sqlite3";
import { MessageStore } from "./message-store.js";
import { isOverflow } from "./overflow.js";

export interface CompactionOptions {
  contextWindow: number;
  buffer?: number;
  keepNewest?: number;
}

type CallLlm = (system: string, user: string) => Promise<string>;

/**
 * Checks whether the session overflows the context window.
 * If so, summarizes old messages via the provided LLM callback,
 * prunes them, and inserts a system summary message.
 *
 * Returns true if compaction was performed, false otherwise.
 */
export async function compactSession(
  db: Database.Database,
  sessionId: string,
  callLlm: CallLlm,
  opts: CompactionOptions,
): Promise<boolean> {
  const store = new MessageStore(db);
  const totalTokens = store.countTokens(sessionId);

  if (!isOverflow(totalTokens, opts.contextWindow, opts.buffer)) {
    return false;
  }

  const messages = store.listBySession(sessionId);
  if (messages.length === 0) return false;

  // EC-2: only system messages -> no compaction (nothing meaningful to summarize)
  const hasNonSystem = messages.some((m) => m.role === "user" || m.role === "assistant");
  if (!hasNonSystem) return false;

  const keepNewest = opts.keepNewest ?? 4;
  const toSummarize = messages.slice(0, Math.max(0, messages.length - keepNewest));

  if (toSummarize.length === 0) return false;

  const conversationText = toSummarize.map((m) => `${m.role}: ${m.content}`).join("\n");

  let summary: string;
  try {
    summary = await callLlm(
      "You are a conversation summarizer. Produce a concise summary of the conversation so far, preserving key decisions, code references, and action items.",
      conversationText,
    );
  } catch {
    // Fallback: leave messages unchanged on LLM error
    return false;
  }

  // Prune the old messages and insert the summary
  store.pruneOldest(sessionId, toSummarize.length);
  store.append(sessionId, {
    sessionId,
    role: "system",
    content: `[Compaction summary]\n${summary}`,
    tokenCount: estimateTokens(summary),
  });

  // Update session timestamp
  db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(Date.now(), sessionId);

  return true;
}

function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token
  return Math.ceil(text.length / 4);
}
