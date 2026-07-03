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
import {
  appendPersistedMessages,
  compactSessionFile,
} from "../../../src/internal/runtime/session/agent-session-store.js";
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

  it("concurrent batch turns are written contiguously — proves single-write batching, not per-message interleave (M6)", async () => {
    // A per-message-loop implementation would interleave the two turns (A1,B1,A2,…);
    // a single locked appendFile per turn keeps each turn's lines contiguous.
    const turnA: StoredMessage[] = [
      { role: "user", content: "A1" },
      { role: "assistant", content: "A2" },
      { role: "tool_result", content: "A3" },
    ];
    const turnB: StoredMessage[] = [
      { role: "user", content: "B1" },
      { role: "assistant", content: "B2" },
      { role: "tool_result", content: "B3" },
    ];
    await Promise.all([store.appendMessages("m6", turnA), store.appendMessages("m6", turnB)]);
    const joined = (await store.getMessages("m6")).map((m) => m.content).join(",");
    expect(joined).toMatch(/A1,A2,A3/); // turn A whole
    expect(joined).toMatch(/B1,B2,B3/); // turn B whole
  });

  it("compaction under the lock never drops a concurrently-appended line (H2)", async () => {
    // Seed enough lines that a compaction to maxTurns=2 (trims to 4 lines) will fire.
    await store.appendMessages(
      "h2",
      Array.from({ length: 10 }, (_, i) => ({ role: "user" as const, content: `seed-${i}` })),
    );
    const dir = store.root;
    // Fire compaction (read→slice→rename) and a concurrent append together. The
    // shared withFileLock serializes them: the appended line survives (compaction
    // either ran before it — then it's the newest kept line — or after — untouched).
    await Promise.all([
      compactSessionFile(dir, "h2", 2),
      appendPersistedMessages(dir, "h2", [{ role: "assistant", text: "RACER", at: 1 }]),
    ]);
    const contents = (await store.getMessages("h2")).map((m) => m.content);
    // The racing append is never dropped by the compaction rename window.
    expect(contents).toContain("RACER");
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
    // L7 — edge/negative windows: offset past the end → [], limit 0 → [].
    expect(await store.getMessages("c3", { offset: 99 })).toEqual([]);
    expect(await store.getMessages("c3", { limit: 0 })).toEqual([]);
  });

  it("truncateConversation reverts to the first keepCount messages (M3 #67)", async () => {
    await store.appendMessages("t67", [
      { role: "user", content: "0" },
      { role: "assistant", content: "1" },
      { role: "user", content: "2" },
      { role: "assistant", content: "3" },
    ]);
    const kept = await store.truncateConversation("t67", 2);
    expect(kept).toBe(2);
    expect((await store.getMessages("t67")).map((m) => m.content)).toEqual(["0", "1"]);
  });

  it("truncateConversation is safe out of range: keep>=len no-op, keep<=0 empties (M3 #67)", async () => {
    await store.appendMessages("t67b", [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ]);
    expect(await store.truncateConversation("t67b", 99)).toBe(2); // no-op
    expect((await store.getMessages("t67b")).length).toBe(2);
    expect(await store.truncateConversation("t67b", 0)).toBe(0); // empties
    expect((await store.getMessages("t67b")).length).toBe(0);
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
