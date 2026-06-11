import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { compactSession } from "../../src/session/compaction.js";
import { MessageStore } from "../../src/session/message-store.js";
import { initDb } from "../../src/session/schema.js";
import { SessionManager } from "../../src/session/session-manager.js";

describe("compactSession", () => {
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

  function addMessages(count: number, tokensEach: number): void {
    for (let i = 0; i < count; i++) {
      store.append(sessionId, {
        sessionId,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Message ${i}`,
        tokenCount: tokensEach,
      });
    }
  }

  it("summarizes old messages when overflow detected", async () => {
    addMessages(10, 100); // 1000 tokens total
    const callLlm = vi.fn().mockResolvedValue("This is a summary");

    const result = await compactSession(db, sessionId, callLlm, {
      contextWindow: 1000, // overflow with buffer of 20_000? No, let's set it so overflow triggers
      buffer: 0, // 1000 >= 1000 - 0 -> overflow
      keepNewest: 3,
    });

    expect(result).toBe(true);
    const messages = store.listBySession(sessionId);
    // Should have 3 kept + 1 summary = 4
    expect(messages).toHaveLength(4);
    // Summary is appended after kept messages (chronologically last)
    const summary = messages.find((m) => m.role === "system");
    expect(summary).toBeDefined();
    expect(summary!.content).toContain("summary");
  });

  it("keeps newest N messages untouched", async () => {
    addMessages(10, 100);
    const callLlm = vi.fn().mockResolvedValue("Summary");

    await compactSession(db, sessionId, callLlm, {
      contextWindow: 500,
      buffer: 0,
      keepNewest: 3,
    });

    const messages = store.listBySession(sessionId);
    // Kept messages are the 3 newest original (before summary was appended)
    const originals = messages.filter((m) => m.role !== "system");
    expect(originals).toHaveLength(3);
    expect(originals.map((m) => m.content)).toContain("Message 7");
    expect(originals.map((m) => m.content)).toContain("Message 8");
    expect(originals.map((m) => m.content)).toContain("Message 9");
  });

  it("skips compaction when no overflow", async () => {
    addMessages(3, 10); // 30 tokens total
    const callLlm = vi.fn();

    const result = await compactSession(db, sessionId, callLlm, {
      contextWindow: 100000,
      buffer: 20000,
    });

    expect(result).toBe(false);
    expect(callLlm).not.toHaveBeenCalled();
    expect(store.listBySession(sessionId)).toHaveLength(3);
  });

  it("persists summary as system message in DB", async () => {
    addMessages(6, 200);
    const callLlm = vi.fn().mockResolvedValue("Compact summary here");

    await compactSession(db, sessionId, callLlm, {
      contextWindow: 500,
      buffer: 0,
      keepNewest: 2,
    });

    const messages = store.listBySession(sessionId);
    const summary = messages.find(
      (m) => m.role === "system" && m.content.includes("[Compaction summary]"),
    );
    expect(summary).toBeDefined();
    expect(summary!.content).toContain("Compact summary here");
  });

  it("updates session timestamp after compaction", async () => {
    addMessages(6, 200);
    const before = Date.now();
    const callLlm = vi.fn().mockResolvedValue("Summary");

    await compactSession(db, sessionId, callLlm, {
      contextWindow: 500,
      buffer: 0,
      keepNewest: 2,
    });

    const mgr = new SessionManager(db);
    const session = mgr.load(sessionId);
    expect(session!.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it("is a no-op with zero messages", async () => {
    const callLlm = vi.fn();

    const result = await compactSession(db, sessionId, callLlm, {
      contextWindow: 100,
      buffer: 0,
    });

    expect(result).toBe(false);
    expect(callLlm).not.toHaveBeenCalled();
  });

  it("calls LLM with conversation text for summarization", async () => {
    addMessages(6, 200);
    const callLlm = vi.fn().mockResolvedValue("Summary");

    await compactSession(db, sessionId, callLlm, {
      contextWindow: 500,
      buffer: 0,
      keepNewest: 2,
    });

    expect(callLlm).toHaveBeenCalledOnce();
    const [system, user] = callLlm.mock.calls[0]!;
    expect(system).toContain("summarizer");
    expect(user).toContain("Message 0");
  });

  it("EC-2: no-op when only system messages exist", async () => {
    // Add only system messages
    for (let i = 0; i < 5; i++) {
      store.append(sessionId, {
        sessionId,
        role: "system",
        content: `System instruction ${i}`,
        tokenCount: 200,
      });
    }
    const callLlm = vi.fn();

    const result = await compactSession(db, sessionId, callLlm, {
      contextWindow: 500,
      buffer: 0,
    });

    expect(result).toBe(false);
    expect(callLlm).not.toHaveBeenCalled();
    expect(store.listBySession(sessionId)).toHaveLength(5);
  });

  it("fallback: leaves messages unchanged on LLM error", async () => {
    addMessages(6, 200);
    const callLlm = vi.fn().mockRejectedValue(new Error("LLM service unavailable"));

    const result = await compactSession(db, sessionId, callLlm, {
      contextWindow: 500,
      buffer: 0,
      keepNewest: 2,
    });

    expect(result).toBe(false);
    expect(store.listBySession(sessionId)).toHaveLength(6);
  });
});
