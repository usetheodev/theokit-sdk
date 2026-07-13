import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Session } from "../src/index.js";
import { FileSystemConversationStorage } from "../src/internal/persistence/conversation-storage-fs.js";
import { InMemoryConversationStorage } from "../src/internal/persistence/conversation-storage-memory.js";
import type {
  ConversationStorageAdapter,
  StoredMessage,
} from "../src/types/conversation-storage.js";

/**
 * SE4 — session-management surface over ConversationStorage. `Session.create(storage)`
 * exposes list/get/rename/tag, deriving light metadata (firstPrompt, lastModified, messageCount)
 * from the transcript, persisting title/tag, and degrading with a typed `{ supported: false }`
 * result for adapters that can't list or write metadata.
 *
 * TDD RED-first.
 */

async function seed(storage: ConversationStorageAdapter): Promise<void> {
  await storage.appendMessage("sess-a", {
    role: "user",
    content: "First question about billing",
    at: 100,
  });
  await storage.appendMessage("sess-a", {
    role: "assistant",
    content: "Here is the answer",
    at: 200,
  });
  await storage.appendMessage("sess-b", { role: "user", content: "Different topic", at: 300 });
}

// A deliberately minimal adapter: no listConversationIds, no setSessionMeta — exercises degradation.
function minimalAdapter(): ConversationStorageAdapter {
  const store = new Map<string, StoredMessage[]>();
  return {
    async getMessages(id) {
      return store.get(id) ?? [];
    },
    async appendMessage(id, m) {
      store.set(id, [...(store.get(id) ?? []), m]);
    },
    async deleteConversation(id) {
      store.delete(id);
    },
  };
}

describe.each([
  ["FileSystemConversationStorage", true],
  ["InMemoryConversationStorage", false],
])("Session (SE4) — round-trip over %s", (_name, isFs) => {
  let root: string | undefined;
  let storage: ConversationStorageAdapter;

  beforeEach(async () => {
    if (isFs) {
      root = await mkdtemp(join(tmpdir(), "theokit-se4-"));
      storage = new FileSystemConversationStorage({ root });
    } else {
      storage = new InMemoryConversationStorage();
    }
    await seed(storage);
  });

  afterEach(async () => {
    if (root !== undefined) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it("lists sessions with light metadata derived from the transcript", async () => {
    const mgr = Session.create(storage);
    const res = await mgr.listSessions();
    expect(res.supported).toBe(true);
    if (!res.supported) return;
    const a = res.value.find((s) => s.id === "sess-a");
    expect(a).toBeDefined();
    expect(a?.messageCount).toBe(2);
    expect(a?.firstPrompt).toBe("First question about billing");
    expect(a?.lastModified).toBe(200);
    // no title yet → summary falls back to the first prompt
    expect(a?.summary).toBe("First question about billing");
  });

  it("renameSession persists a title (round-trips through the store)", async () => {
    const mgr = Session.create(storage);
    const r = await mgr.renameSession("sess-a", "Billing thread");
    expect(r.supported).toBe(true);
    const res = await mgr.listSessions();
    if (!res.supported) throw new Error("listSessions unexpectedly unsupported");
    const a = res.value.find((s) => s.id === "sess-a");
    expect(a?.title).toBe("Billing thread");
    expect(a?.summary).toBe("Billing thread"); // title wins over firstPrompt
  });

  it("tagSession sets then clears a tag (null clears)", async () => {
    const mgr = Session.create(storage);
    expect((await mgr.tagSession("sess-a", "important")).supported).toBe(true);
    let res = await mgr.listSessions();
    if (!res.supported) throw new Error("unsupported");
    expect(res.value.find((s) => s.id === "sess-a")?.tag).toBe("important");

    expect((await mgr.tagSession("sess-a", null)).supported).toBe(true);
    res = await mgr.listSessions();
    if (!res.supported) throw new Error("unsupported");
    expect(res.value.find((s) => s.id === "sess-a")?.tag).toBeUndefined();
  });

  it("getSessionMessages passes through to the stored transcript", async () => {
    const mgr = Session.create(storage);
    const msgs = await mgr.getSessionMessages("sess-a");
    expect(msgs.map((m) => m.content)).toEqual([
      "First question about billing",
      "Here is the answer",
    ]);
  });

  it("drops a deleted session (and its metadata) from listSessions", async () => {
    const mgr = Session.create(storage);
    await mgr.tagSession("sess-a", "keep");
    await storage.deleteConversation("sess-a");
    const res = await mgr.listSessions();
    if (!res.supported) throw new Error("unsupported");
    expect(res.value.find((s) => s.id === "sess-a")).toBeUndefined();
    // The metadata must not resurrect if the id is recreated (ghost-meta guard).
    await storage.appendMessage("sess-a", { role: "user", content: "brand new", at: 999 });
    const res2 = await mgr.listSessions();
    if (!res2.supported) throw new Error("unsupported");
    expect(res2.value.find((s) => s.id === "sess-a")?.tag).toBeUndefined();
  });

  it("windows listSessions by offset/limit and returns [] for a non-positive limit", async () => {
    const mgr = Session.create(storage);
    const one = await mgr.listSessions({ limit: 1 });
    if (!one.supported) throw new Error("unsupported");
    expect(one.value).toHaveLength(1);

    const none = await mgr.listSessions({ limit: -1 });
    if (!none.supported) throw new Error("unsupported");
    expect(none.value).toEqual([]);
  });

  it("renameSession creates metadata lazily for a not-yet-tagged session", async () => {
    const mgr = Session.create(storage);
    // sess-b exists but has no metadata yet — rename must create it.
    expect((await mgr.renameSession("sess-b", "Renamed B")).supported).toBe(true);
    const res = await mgr.listSessions();
    if (!res.supported) throw new Error("unsupported");
    expect(res.value.find((s) => s.id === "sess-b")?.title).toBe("Renamed B");
  });
});

describe("Session (SE4) — FileSystem durability + fail-loud", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "theokit-se4-fs-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("persists a renamed title to DISK (survives a fresh adapter over the same root)", async () => {
    const storage = new FileSystemConversationStorage({ root });
    await storage.appendMessage("sess-a", { role: "user", content: "hi", at: 1 });
    await Session.create(storage).renameSession("sess-a", "Billing thread");

    // Brand-new adapter instance over the same root — no in-process state carried.
    const reopened = Session.create(new FileSystemConversationStorage({ root }));
    const res = await reopened.listSessions();
    if (!res.supported) throw new Error("unsupported");
    expect(res.value.find((s) => s.id === "sess-a")?.title).toBe("Billing thread");
  });

  it("fails loud on a malformed session.json (does NOT silently return undefined)", async () => {
    const storage = new FileSystemConversationStorage({ root });
    await storage.appendMessage("sess-a", { role: "user", content: "hi", at: 1 });
    // Corrupt the sidecar directly.
    const metaPath = join(root, ".theokit", "agents", "sess-a", "session.json");
    await writeFile(metaPath, "{ not valid json", "utf8");
    await expect(storage.getSessionMeta?.("sess-a")).rejects.toThrow();
  });
});

describe("Session (SE4) — typed degradation for incapable adapters", () => {
  it("returns { supported: false } for list/rename/tag but getSessionMessages still works", async () => {
    const storage = minimalAdapter();
    await seed(storage);
    const mgr = Session.create(storage);

    const list = await mgr.listSessions();
    expect(list.supported).toBe(false);
    if (!list.supported) expect(list.reason).toMatch(/list/i);

    const renamed = await mgr.renameSession("sess-a", "x");
    expect(renamed.supported).toBe(false);

    const tagged = await mgr.tagSession("sess-a", "y");
    expect(tagged.supported).toBe(false);

    // getSessionMessages relies only on the mandatory getMessages — still works.
    const msgs = await mgr.getSessionMessages("sess-a");
    expect(msgs).toHaveLength(2);
  });
});
