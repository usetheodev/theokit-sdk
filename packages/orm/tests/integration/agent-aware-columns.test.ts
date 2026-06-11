import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Repository, withAgentContext } from "../../src/index.js";

const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  payload: text("payload").notNull(),
  agentId: text("agent_id"),
  runId: text("run_id"),
  conversationId: text("conversation_id"),
});

const simpleUsers = sqliteTable("simple_users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<Record<string, never>>>;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(
    `CREATE TABLE events (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      agent_id TEXT,
      run_id TEXT,
      conversation_id TEXT
    );`,
  );
  sqlite.exec(`CREATE TABLE simple_users (id TEXT PRIMARY KEY, name TEXT NOT NULL);`);
  db = drizzle(sqlite);
});

afterEach(() => {
  sqlite.close();
});

describe("Agent-aware columns auto-fill", () => {
  it("insert autofills agentId/runId/conversationId when columns exist and context is set", async () => {
    const repo = new Repository(db, events);
    await withAgentContext({ agentId: "a1", runId: "r1", conversationId: "c1" }, async () => {
      const row = await repo.insert({ id: "e1", payload: "hello" });
      expect(row.agentId).toBe("a1");
      expect(row.runId).toBe("r1");
      expect(row.conversationId).toBe("c1");
    });
  });

  it("explicit value overrides auto-fill", async () => {
    const repo = new Repository(db, events);
    await withAgentContext({ agentId: "ctx-agent" }, async () => {
      const row = await repo.insert({
        id: "e1",
        payload: "hello",
        agentId: "explicit-agent",
      });
      expect(row.agentId).toBe("explicit-agent");
    });
  });

  it("no-op when context is not set", async () => {
    const repo = new Repository(db, events);
    const row = await repo.insert({ id: "e1", payload: "hello" });
    expect(row.agentId).toBeNull();
    expect(row.runId).toBeNull();
  });

  it("no-op when table lacks the agent columns", async () => {
    const repo = new Repository(db, simpleUsers);
    await withAgentContext({ agentId: "a1" }, async () => {
      const row = await repo.insert({ id: "u1", name: "Ada" });
      expect(row).toEqual({ id: "u1", name: "Ada" });
    });
  });

  it("update autofills missing tracked columns", async () => {
    const repo = new Repository(db, events);
    await repo.insert({ id: "e1", payload: "v1" });
    await withAgentContext({ agentId: "from-update" }, async () => {
      const updated = await repo.update("e1", { payload: "v2" });
      expect(updated.agentId).toBe("from-update");
      expect(updated.payload).toBe("v2");
    });
  });
});
