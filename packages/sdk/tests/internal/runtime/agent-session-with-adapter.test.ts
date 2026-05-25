import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";
import { FileSystemConversationStorage } from "../../../src/internal/persistence/conversation-storage-fs.js";
import { InMemoryConversationStorage } from "../../../src/internal/persistence/conversation-storage-memory.js";
import {
  appendSessionMessage,
  clearAllSessions,
  flushSessionWrites,
  getSessionMessages,
  hydrateSession,
} from "../../../src/internal/runtime/agent-session.js";

describe("agent-session — ConversationStorageAdapter integration", () => {
  beforeEach(() => {
    clearAllSessions();
  });

  it("appendSessionMessage with InMemoryConversationStorage skips FS entirely", async () => {
    const storage = new InMemoryConversationStorage();
    appendSessionMessage("agent-mem", { role: "user", text: "hi" }, storage);
    await flushSessionWrites();
    const msgs = await storage.getMessages("agent-mem");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.content).toBe("hi");
  });

  it("appendSessionMessage with cwd string still works (backcompat)", async () => {
    const root = await mkdtemp(join(tmpdir(), "theokit-session-bcwd-"));
    try {
      appendSessionMessage("agent-bcwd", { role: "user", text: "back-compat" }, root);
      await flushSessionWrites();
      const storage = new FileSystemConversationStorage({ root });
      const msgs = await storage.getMessages("agent-bcwd");
      expect(msgs).toHaveLength(1);
      expect(msgs[0]?.content).toBe("back-compat");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("appendSessionMessage with FileSystemConversationStorage instance works", async () => {
    const root = await mkdtemp(join(tmpdir(), "theokit-session-fs-"));
    try {
      const storage = new FileSystemConversationStorage({ root });
      appendSessionMessage("agent-fs", { role: "user", text: "fs-direct" }, storage);
      await flushSessionWrites();
      const msgs = await storage.getMessages("agent-fs");
      expect(msgs).toHaveLength(1);
      expect(msgs[0]?.content).toBe("fs-direct");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("hydrateSession reads from InMemory adapter into cache", async () => {
    const storage = new InMemoryConversationStorage();
    await storage.appendMessage("agent-hyd", { role: "user", content: "first" });
    await storage.appendMessage("agent-hyd", { role: "assistant", content: "reply" });

    expect(getSessionMessages("agent-hyd")).toEqual([]); // cold cache

    await hydrateSession("agent-hyd", storage);
    const cached = getSessionMessages("agent-hyd");
    expect(cached).toHaveLength(2);
    expect(cached.map((m) => m.text)).toEqual(["first", "reply"]);
  });

  it("hydrateSession is idempotent per (agent, storage) pair", async () => {
    const storage = new InMemoryConversationStorage();
    await storage.appendMessage("agent-idem", { role: "user", content: "once" });

    await hydrateSession("agent-idem", storage);
    expect(getSessionMessages("agent-idem")).toHaveLength(1);

    // Second hydrate is a no-op (entry already in hydratedKeys).
    await storage.appendMessage("agent-idem", { role: "user", content: "added-later" });
    await hydrateSession("agent-idem", storage);
    expect(getSessionMessages("agent-idem")).toHaveLength(1); // still 1
  });

  it("InMemory adapter without compact() does not crash on threshold trigger", async () => {
    const storage = new InMemoryConversationStorage();
    // 51 appends → trigger compaction check (every 50). InMemory doesn't
    // implement `compact`, so the wrapper must skip silently.
    for (let i = 0; i < 51; i++) {
      appendSessionMessage("agent-no-compact", { role: "user", text: `m${i}` }, storage);
    }
    await flushSessionWrites();
    const msgs = await storage.getMessages("agent-no-compact");
    expect(msgs).toHaveLength(51);
  });
});
