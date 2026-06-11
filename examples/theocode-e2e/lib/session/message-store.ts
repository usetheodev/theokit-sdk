import type Database from "better-sqlite3";

export interface Message {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  tokenCount: number;
  toolCallId?: string;
  createdAt: number;
}

export class MessageStore {
  constructor(private readonly db: Database.Database) {}

  append(sessionId: string, msg: Omit<Message, "id" | "createdAt">): Message {
    const id = crypto.randomUUID();
    const createdAt = Date.now();

    this.db
      .prepare(
        `INSERT INTO messages (id, session_id, role, content, token_count, tool_call_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, sessionId, msg.role, msg.content, msg.tokenCount, msg.toolCallId ?? null, createdAt);

    // Bump session updated_at
    this.db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(createdAt, sessionId);

    return {
      id,
      sessionId,
      role: msg.role,
      content: msg.content,
      tokenCount: msg.tokenCount,
      toolCallId: msg.toolCallId,
      createdAt,
    };
  }

  listBySession(sessionId: string): Message[] {
    const rows = this.db
      .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC")
      .all(sessionId) as MessageRow[];

    return rows.map(toMessage);
  }

  pruneOldest(sessionId: string, count: number): number {
    const result = this.db
      .prepare(
        `DELETE FROM messages WHERE id IN (
           SELECT id FROM messages
           WHERE session_id = ?
           ORDER BY created_at ASC
           LIMIT ?
         )`,
      )
      .run(sessionId, count);

    return result.changes;
  }

  countTokens(sessionId: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(SUM(token_count), 0) AS total FROM messages WHERE session_id = ?")
      .get(sessionId) as { total: number };

    return row.total;
  }
}

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  token_count: number;
  tool_call_id: string | null;
  created_at: number;
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    tokenCount: row.token_count,
    toolCallId: row.tool_call_id ?? undefined,
    createdAt: row.created_at,
  };
}
