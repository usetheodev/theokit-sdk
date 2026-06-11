import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { MessageStore } from "../../src/session/message-store.js";
import { initDb } from "../../src/session/schema.js";
import { SessionManager } from "../../src/session/session-manager.js";

describe("MessageStore", () => {
  let db: Database.Database;
  let store: MessageStore;
  let sessionId: string;

  beforeEach(() => {
    db = new Database(":memory:");
    initDb(db);
    store = new MessageStore(db);

    const mgr = new SessionManager(db);
    sessionId = mgr.create("/tmp/project").id;
  });

  it("append persists a message", () => {
    const msg = store.append(sessionId, {
      sessionId,
      role: "user",
      content: "Hello, world!",
      tokenCount: 3,
    });

    expect(msg.id).toBeDefined();
    expect(msg.role).toBe("user");
    expect(msg.content).toBe("Hello, world!");
    expect(msg.tokenCount).toBe(3);

    const list = store.listBySession(sessionId);
    expect(list).toHaveLength(1);
    expect(list[0]!.content).toBe("Hello, world!");
  });

  it("append supports all four roles", () => {
    const roles = ["user", "assistant", "system", "tool"] as const;
    for (const role of roles) {
      store.append(sessionId, {
        sessionId,
        role,
        content: `${role} message`,
        tokenCount: 5,
      });
    }

    const list = store.listBySession(sessionId);
    expect(list).toHaveLength(4);
    expect(list.map((m) => m.role)).toEqual(["user", "assistant", "system", "tool"]);
  });

  it("listBySession returns messages in chronological order", () => {
    for (let i = 0; i < 3; i++) {
      store.append(sessionId, {
        sessionId,
        role: "user",
        content: `Message ${i}`,
        tokenCount: 5,
      });
    }

    const list = store.listBySession(sessionId);
    expect(list[0]!.content).toBe("Message 0");
    expect(list[1]!.content).toBe("Message 1");
    expect(list[2]!.content).toBe("Message 2");
  });

  it("message has tokenCount", () => {
    const msg = store.append(sessionId, {
      sessionId,
      role: "user",
      content: "test",
      tokenCount: 42,
    });

    expect(msg.tokenCount).toBe(42);

    const list = store.listBySession(sessionId);
    expect(list[0]!.tokenCount).toBe(42);
  });

  it("message has toolCallId when provided", () => {
    const msg = store.append(sessionId, {
      sessionId,
      role: "tool",
      content: "result",
      tokenCount: 10,
      toolCallId: "call_abc123",
    });

    expect(msg.toolCallId).toBe("call_abc123");

    const list = store.listBySession(sessionId);
    expect(list[0]!.toolCallId).toBe("call_abc123");
  });

  it("pruneOldest removes the N oldest messages", () => {
    for (let i = 0; i < 5; i++) {
      store.append(sessionId, {
        sessionId,
        role: "user",
        content: `Message ${i}`,
        tokenCount: 10,
      });
    }

    const pruned = store.pruneOldest(sessionId, 2);
    expect(pruned).toBe(2);

    const remaining = store.listBySession(sessionId);
    expect(remaining).toHaveLength(3);
    expect(remaining[0]!.content).toBe("Message 2");
  });

  it("countTokens returns total for a session", () => {
    store.append(sessionId, {
      sessionId,
      role: "user",
      content: "a",
      tokenCount: 100,
    });
    store.append(sessionId, {
      sessionId,
      role: "assistant",
      content: "b",
      tokenCount: 150,
    });
    store.append(sessionId, {
      sessionId,
      role: "user",
      content: "c",
      tokenCount: 50,
    });

    expect(store.countTokens(sessionId)).toBe(300);
  });

  it("listBySession returns empty array for session with no messages", () => {
    const list = store.listBySession(sessionId);
    expect(list).toEqual([]);
  });
});
