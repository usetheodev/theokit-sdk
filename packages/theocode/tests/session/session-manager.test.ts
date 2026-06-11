import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { MessageStore } from "../../src/session/message-store.js";
import { initDb } from "../../src/session/schema.js";
import { SessionManager } from "../../src/session/session-manager.js";

describe("SessionManager", () => {
  let db: Database.Database;
  let mgr: SessionManager;

  beforeEach(() => {
    db = new Database(":memory:");
    initDb(db);
    mgr = new SessionManager(db);
  });

  it("create returns a session with id", () => {
    const session = mgr.create("/tmp/project");

    expect(session.id).toBeDefined();
    expect(typeof session.id).toBe("string");
    expect(session.title).toBe("Untitled");
    expect(session.projectRoot).toBe("/tmp/project");
    expect(session.createdAt).toBeGreaterThan(0);
  });

  it("load returns the created session", () => {
    const created = mgr.create("/tmp/project", "My Session");
    const loaded = mgr.load(created.id);

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(created.id);
    expect(loaded!.title).toBe("My Session");
    expect(loaded!.projectRoot).toBe("/tmp/project");
  });

  it("list returns all sessions", () => {
    mgr.create("/tmp/a");
    mgr.create("/tmp/b");
    mgr.create("/tmp/c");

    const sessions = mgr.list();
    expect(sessions).toHaveLength(3);
  });

  it("list returns sessions ordered by updated_at descending", () => {
    const s1 = mgr.create("/tmp/a", "First");
    // Force different updated_at by direct UPDATE
    db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(100, s1.id);
    const s2 = mgr.create("/tmp/b", "Second");
    db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(300, s2.id);
    const s3 = mgr.create("/tmp/c", "Third");
    db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(200, s3.id);

    const sessions = mgr.list();
    expect(sessions[0]!.title).toBe("Second");
    expect(sessions[1]!.title).toBe("Third");
    expect(sessions[2]!.title).toBe("First");
  });

  it("delete removes the session", () => {
    const session = mgr.create("/tmp/project");
    const deleted = mgr.delete(session.id);

    expect(deleted).toBe(true);
    expect(mgr.load(session.id)).toBeNull();
  });

  it("delete cascades to messages", () => {
    const session = mgr.create("/tmp/project");
    const store = new MessageStore(db);
    store.append(session.id, {
      sessionId: session.id,
      role: "user",
      content: "hello",
      tokenCount: 5,
    });

    mgr.delete(session.id);

    const messages = store.listBySession(session.id);
    expect(messages).toHaveLength(0);
  });

  it("fork copies messages to a new session", () => {
    const source = mgr.create("/tmp/project", "Original");
    const store = new MessageStore(db);

    for (let i = 0; i < 3; i++) {
      store.append(source.id, {
        sessionId: source.id,
        role: "user",
        content: `Message ${i}`,
        tokenCount: 10,
      });
    }

    const forked = mgr.fork(source.id, "Forked");
    expect(forked).not.toBeNull();
    expect(forked!.title).toBe("Forked");

    const forkedMessages = store.listBySession(forked!.id);
    expect(forkedMessages).toHaveLength(3);
    expect(forkedMessages[0]!.content).toBe("Message 0");
  });

  it("load returns null for nonexistent session", () => {
    const result = mgr.load("does-not-exist");
    expect(result).toBeNull();
  });
});
