import { describe, expect, it } from "vitest";

import { InMemoryConversationStorage } from "../../../src/internal/persistence/conversation-storage-memory.js";

describe("InMemoryConversationStorage", () => {
  it("returns [] for unknown conversation (not throw)", async () => {
    const s = new InMemoryConversationStorage();
    expect(await s.getMessages("does-not-exist")).toEqual([]);
  });

  it("appendMessage creates the conversation lazily", async () => {
    const s = new InMemoryConversationStorage();
    await s.appendMessage("new-id", { role: "user", content: "hi" });
    const msgs = await s.getMessages("new-id");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.content).toBe("hi");
  });

  it("preserves insertion order across appends", async () => {
    const s = new InMemoryConversationStorage();
    await s.appendMessage("c", { role: "user", content: "a" });
    await s.appendMessage("c", { role: "assistant", content: "b" });
    await s.appendMessage("c", { role: "user", content: "c" });
    const msgs = await s.getMessages("c");
    expect(msgs.map((m) => m.content)).toEqual(["a", "b", "c"]);
  });

  it("concurrent appends do not corrupt the log", async () => {
    const s = new InMemoryConversationStorage();
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        s.appendMessage("race", { role: "user", content: `m${i}` }),
      ),
    );
    const msgs = await s.getMessages("race");
    expect(msgs).toHaveLength(50);
  });

  it("deleteConversation is idempotent", async () => {
    const s = new InMemoryConversationStorage();
    await s.deleteConversation("never-existed"); // should not throw
    await s.appendMessage("to-delete", { role: "user", content: "x" });
    await s.deleteConversation("to-delete");
    await s.deleteConversation("to-delete"); // second call also ok
    expect(await s.getMessages("to-delete")).toEqual([]);
  });

  it("getMessages returns defensive copy (mutation does not affect storage)", async () => {
    const s = new InMemoryConversationStorage();
    await s.appendMessage("c", { role: "user", content: "a" });
    const msgs = await s.getMessages("c");
    (msgs as StoredMessageArray).push({ role: "user", content: "stolen" });
    expect(await s.getMessages("c")).toHaveLength(1);
  });

  it("listConversationIds respects limit option", async () => {
    const s = new InMemoryConversationStorage();
    await s.appendMessage("a", { role: "user", content: "1" });
    await s.appendMessage("b", { role: "user", content: "2" });
    await s.appendMessage("c", { role: "user", content: "3" });
    const limited = await s.listConversationIds?.({ limit: 2 });
    expect(limited).toHaveLength(2);
    const all = await s.listConversationIds?.();
    expect(all).toHaveLength(3);
  });

  it("appendMessage stamps `at` when not provided", async () => {
    const s = new InMemoryConversationStorage();
    const before = Date.now();
    await s.appendMessage("c", { role: "user", content: "x" });
    const after = Date.now();
    const msgs = await s.getMessages("c");
    expect(msgs[0]?.at).toBeGreaterThanOrEqual(before);
    expect(msgs[0]?.at).toBeLessThanOrEqual(after);
  });

  it("dispose clears all data and is idempotent", async () => {
    const s = new InMemoryConversationStorage();
    await s.appendMessage("c", { role: "user", content: "x" });
    await s.dispose?.();
    await s.dispose?.(); // second call ok
    expect(await s.getMessages("c")).toEqual([]);
  });
});

// Type alias for the mutation cast in defensive-copy test.
type StoredMessageArray = Array<{ role: "user" | "assistant"; content: string }>;
