import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { initDb } from "../../src/session/schema.js";

describe("session schema", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initDb(db);
  });

  it("creates the sessions table", () => {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'")
      .get() as { name: string } | undefined;

    expect(row).toBeDefined();
    expect(row!.name).toBe("sessions");
  });

  it("creates the messages table", () => {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'")
      .get() as { name: string } | undefined;

    expect(row).toBeDefined();
    expect(row!.name).toBe("messages");
  });

  it("sessions table has required columns", () => {
    const cols = db.prepare("PRAGMA table_info(sessions)").all() as Array<{
      name: string;
    }>;
    const names = cols.map((c) => c.name);

    expect(names).toContain("id");
    expect(names).toContain("title");
    expect(names).toContain("project_root");
    expect(names).toContain("created_at");
    expect(names).toContain("updated_at");
  });

  it("messages table has required columns", () => {
    const cols = db.prepare("PRAGMA table_info(messages)").all() as Array<{
      name: string;
    }>;
    const names = cols.map((c) => c.name);

    expect(names).toContain("id");
    expect(names).toContain("session_id");
    expect(names).toContain("role");
    expect(names).toContain("content");
    expect(names).toContain("token_count");
    expect(names).toContain("tool_call_id");
    expect(names).toContain("created_at");
  });

  it("enforces foreign key constraint on messages", () => {
    expect(() => {
      db.prepare(
        `INSERT INTO messages (id, session_id, role, content, token_count, created_at)
         VALUES ('msg-1', 'nonexistent-session', 'user', 'hello', 5, ${Date.now()})`,
      ).run();
    }).toThrow();
  });
});
