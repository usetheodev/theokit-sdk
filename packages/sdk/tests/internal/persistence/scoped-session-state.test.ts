/**
 * M3 #62 (T4.2) — RED-first: scoped session state (app:/user:/temp:). Scopes
 * isolate transcripts on the same base id; deleteScope("temp:") prunes the temp
 * scope while app/user survive.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileSystemConversationStorage } from "../../../src/internal/persistence/conversation-storage-fs.js";
import { InMemoryConversationStorage } from "../../../src/internal/persistence/conversation-storage-memory.js";
import { scopedConversationId, sessionScopePrefix } from "../../../src/session-scope.js";

describe("M3 #62 — scoped session state", () => {
  it("scopes isolate transcripts on the same base id (in-memory)", async () => {
    const store = new InMemoryConversationStorage();
    await store.appendMessage(scopedConversationId("app", "c"), { role: "user", content: "APP" });
    await store.appendMessage(scopedConversationId("user", "c"), { role: "user", content: "USER" });
    await store.appendMessage(scopedConversationId("temp", "c"), { role: "user", content: "TEMP" });
    expect((await store.getMessages("app__c")).map((m) => m.content)).toEqual(["APP"]);
    expect((await store.getMessages("user__c")).map((m) => m.content)).toEqual(["USER"]);
    expect((await store.getMessages("temp__c")).map((m) => m.content)).toEqual(["TEMP"]);
  });

  it("deleteScope('temp:') prunes only the temp scope (in-memory)", async () => {
    const store = new InMemoryConversationStorage();
    await store.appendMessage("app__x", { role: "user", content: "a" });
    await store.appendMessage("temp__x", { role: "user", content: "t1" });
    await store.appendMessage("temp__y", { role: "user", content: "t2" });
    const deleted = await store.deleteScope(sessionScopePrefix("temp"));
    expect(deleted).toBe(2);
    expect((await store.getMessages("temp__x")).length).toBe(0);
    expect((await store.getMessages("app__x")).map((m) => m.content)).toEqual(["a"]);
  });

  it("deleteScope prunes on the FS adapter too", async () => {
    const root = mkdtempSync(join(tmpdir(), "scoped-"));
    const store = new FileSystemConversationStorage({ root });
    await store.appendMessage("temp__a", { role: "user", content: "t" });
    await store.appendMessage("user__a", { role: "user", content: "u" });
    const deleted = await store.deleteScope(sessionScopePrefix("temp"));
    expect(deleted).toBe(1);
    expect((await store.getMessages("temp__a")).length).toBe(0);
    expect((await store.getMessages("user__a")).map((m) => m.content)).toEqual(["u"]);
    await store.dispose();
  });
});
