import type Database from "better-sqlite3";

export interface Session {
  id: string;
  title: string;
  projectRoot: string;
  createdAt: number;
  updatedAt: number;
}

const FORK_CHUNK_SIZE = 500;

export class SessionManager {
  constructor(private readonly db: Database.Database) {}

  create(projectRoot: string, title?: string): Session {
    const id = crypto.randomUUID();
    const now = Date.now();
    const t = title ?? "Untitled";

    this.db
      .prepare(
        `INSERT INTO sessions (id, title, project_root, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, t, projectRoot, now, now);

    return { id, title: t, projectRoot, createdAt: now, updatedAt: now };
  }

  load(id: string): Session | null {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
      | SessionRow
      | undefined;

    if (!row) return null;
    return toSession(row);
  }

  list(): Session[] {
    const rows = this.db
      .prepare("SELECT * FROM sessions ORDER BY updated_at DESC")
      .all() as SessionRow[];

    return rows.map(toSession);
  }

  delete(id: string): boolean {
    const result = this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    return result.changes > 0;
  }

  fork(sourceId: string, newTitle?: string): Session | null {
    const source = this.load(sourceId);
    if (!source) return null;

    const newSession = this.create(source.projectRoot, newTitle ?? `Fork of ${source.title}`);

    const messages = this.db
      .prepare(
        "SELECT role, content, token_count, tool_call_id, created_at FROM messages WHERE session_id = ? ORDER BY created_at ASC",
      )
      .all(sourceId) as MessageRow[];

    // EC-1: batch INSERT in chunks of 500 to prevent SQLite lock pressure
    const insert = this.db.prepare(
      `INSERT INTO messages (id, session_id, role, content, token_count, tool_call_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    for (let i = 0; i < messages.length; i += FORK_CHUNK_SIZE) {
      const chunk = messages.slice(i, i + FORK_CHUNK_SIZE);
      const batchInsert = this.db.transaction(() => {
        for (const msg of chunk) {
          insert.run(
            crypto.randomUUID(),
            newSession.id,
            msg.role,
            msg.content,
            msg.token_count,
            msg.tool_call_id,
            msg.created_at,
          );
        }
      });
      batchInsert();
    }

    return newSession;
  }

  updateTitle(id: string, title: string): void {
    this.db
      .prepare("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?")
      .run(title, Date.now(), id);
  }
}

interface SessionRow {
  id: string;
  title: string;
  project_root: string;
  created_at: number;
  updated_at: number;
}

interface MessageRow {
  role: string;
  content: string;
  token_count: number;
  tool_call_id: string | null;
  created_at: number;
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    title: row.title,
    projectRoot: row.project_root,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
