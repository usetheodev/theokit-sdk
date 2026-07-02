/**
 * M2 #63 — RED-first: batch turn append (one locked write, not N), cross-process-safe
 * (no torn/interleaved JSONL line), and paginated reads. FS + memory adapters.
 */
import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSystemConversationStorage } from "../../../src/internal/persistence/conversation-storage-fs.js";
import { InMemoryConversationStorage } from "../../../src/internal/persistence/conversation-storage-memory.js";
import type { StoredMessage } from "../../../src/types/conversation-storage.js";

function turn(): StoredMessage[] {
  return [
    { role: "user", content: "do the thing" },
    { role: "assistant", content: "calling tool" },
    { role: "tool_call", content: '{"name":"shell"}' },
    { role: "tool_result", content: "ok" },
  ];
}

describe("M2 #63 — FS batch append + pagination", () => {
  let root: string;
  let store: FileSystemConversationStorage;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "conv-batch-"));
    store = new FileSystemConversationStorage({ root });
  });
  afterEach(async () => {
    await store.dispose();
  });

  it("appendMessages writes a whole turn in ONE file write (one line per message, in order)", async () => {
    await store.appendMessages("c1", turn());
    const path = join(root, ".theokit", "agents", "c1", "messages.jsonl");
    const raw = await readFile(path, "utf8");
    const lines = raw.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(4);
    const roles = (await store.getMessages("c1")).map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "tool_call", "tool_result"]);
  });

  it("concurrent batch appends never tear or interleave a JSONL line (lock)", async () => {
    // A >4KB message: without a lock two concurrent appends could interleave into
    // a torn line. With the file lock every line stays intact.
    const big = "x".repeat(5000);
    const writers = Array.from({ length: 6 }, (_, i) =>
      store.appendMessages("race", [{ role: "user", content: `${i}-${big}` }]),
    );
    await Promise.all(writers);
    const path = join(root, ".theokit", "agents", "race", "messages.jsonl");
    const raw = await readFile(path, "utf8");
    const lines = raw.split("\n").filter((l) => l.length > 0);
    // Exactly 6 intact lines, each parseable JSON (no torn/interleaved content).
    expect(lines).toHaveLength(6);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("appendMessage (single) still works and shares the same log", async () => {
    await store.appendMessage("c2", { role: "user", content: "hi" });
    await store.appendMessage("c2", { role: "assistant", content: "yo" });
    expect((await store.getMessages("c2")).map((m) => m.content)).toEqual(["hi", "yo"]);
  });

  it("getMessages honors an { offset, limit } window; no opts = full history", async () => {
    await store.appendMessages("c3", [
      { role: "user", content: "0" },
      { role: "assistant", content: "1" },
      { role: "user", content: "2" },
      { role: "assistant", content: "3" },
    ]);
    expect((await store.getMessages("c3")).map((m) => m.content)).toEqual(["0", "1", "2", "3"]);
    expect((await store.getMessages("c3", { offset: 1, limit: 2 })).map((m) => m.content)).toEqual([
      "1",
      "2",
    ]);
    expect((await store.getMessages("c3", { limit: 1 })).map((m) => m.content)).toEqual(["0"]);
    expect((await store.getMessages("c3", { offset: 3 })).map((m) => m.content)).toEqual(["3"]);
  });
});

describe("M2 #63 — in-memory batch append + pagination", () => {
  it("appendMessages appends the whole turn; getMessages paginates", async () => {
    const store = new InMemoryConversationStorage();
    await store.appendMessages("m1", turn());
    expect(await store.getMessages("m1")).toHaveLength(4);
    expect((await store.getMessages("m1", { offset: 2, limit: 1 })).map((m) => m.role)).toEqual([
      "tool_call",
    ]);
  });
});
