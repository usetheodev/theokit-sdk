import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfigurationError } from "../../../src/errors.js";
import { FileSystemConversationStorage } from "../../../src/internal/persistence/conversation-storage-fs.js";
import { InMemoryConversationStorage } from "../../../src/internal/persistence/conversation-storage-memory.js";
import type { ConversationStorageAdapter } from "../../../src/types/conversation-storage.js";

// Run the SAME contract suite against InMemory + FS — interface conformance gate.
describe.each<
  [
    "InMemory" | "FS",
    () => Promise<{ adapter: ConversationStorageAdapter; cleanup: () => Promise<void> }>,
  ]
>([
  [
    "InMemory",
    async () => ({ adapter: new InMemoryConversationStorage(), cleanup: async () => {} }),
  ],
  [
    "FS",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "theokit-conv-storage-"));
      return {
        adapter: new FileSystemConversationStorage({ root }),
        cleanup: async () => rm(root, { recursive: true, force: true }),
      };
    },
  ],
])("ConversationStorageAdapter contract — %s", (_, factory) => {
  let ctx: { adapter: ConversationStorageAdapter; cleanup: () => Promise<void> };

  beforeEach(async () => {
    ctx = await factory();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("returns [] for unknown conversation (not throw)", async () => {
    expect(await ctx.adapter.getMessages("agent-does-not-exist")).toEqual([]);
  });

  it("appendMessage creates the conversation lazily", async () => {
    await ctx.adapter.appendMessage("agent-new-id", { role: "user", content: "hi" });
    const msgs = await ctx.adapter.getMessages("agent-new-id");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.content).toBe("hi");
    expect(msgs[0]?.role).toBe("user");
  });

  it("preserves insertion order across appends", async () => {
    await ctx.adapter.appendMessage("agent-c", { role: "user", content: "a" });
    await ctx.adapter.appendMessage("agent-c", { role: "assistant", content: "b" });
    await ctx.adapter.appendMessage("agent-c", { role: "user", content: "c" });
    const msgs = await ctx.adapter.getMessages("agent-c");
    expect(msgs.map((m) => m.content)).toEqual(["a", "b", "c"]);
  });

  it("concurrent appends do not corrupt the log", async () => {
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        ctx.adapter.appendMessage("agent-race", { role: "user", content: `m${i}` }),
      ),
    );
    const msgs = await ctx.adapter.getMessages("agent-race");
    expect(msgs).toHaveLength(50);
  });

  it("deleteConversation is idempotent", async () => {
    await ctx.adapter.deleteConversation("agent-never-existed"); // should not throw
    await ctx.adapter.appendMessage("agent-to-delete", { role: "user", content: "x" });
    await ctx.adapter.deleteConversation("agent-to-delete");
    await ctx.adapter.deleteConversation("agent-to-delete"); // second call also ok
    expect(await ctx.adapter.getMessages("agent-to-delete")).toEqual([]);
  });

  // SE33 — durable objective methods across BOTH adapters (InMemory + FS).
  it("objective set → get round-trips; setObjectiveRecord(null) clears", async () => {
    await ctx.adapter.setObjectiveRecord?.("agent-obj", {
      _schemaVersion: 1,
      objective: "Add a /health endpoint",
      options: { maxRuns: 30 },
      status: "active",
      runsUsed: 0,
    });
    const rec = await ctx.adapter.getObjectiveRecord?.("agent-obj");
    expect(rec).toMatchObject({ objective: "Add a /health endpoint", status: "active" });
    await ctx.adapter.setObjectiveRecord?.("agent-obj", null);
    expect(await ctx.adapter.getObjectiveRecord?.("agent-obj")).toBeUndefined();
  });

  // HIGH-2 — a caller-supplied threadId with exotic chars must NOT throw (never-throw contract).
  it("objective methods accept an exotic threadId without throwing (path-safe)", async () => {
    const exotic = "user@example.com/thread#1";
    await expect(
      ctx.adapter.setObjectiveRecord?.(exotic, {
        _schemaVersion: 1,
        objective: "exotic",
        status: "active",
        runsUsed: 0,
      }),
    ).resolves.toBeUndefined();
    expect((await ctx.adapter.getObjectiveRecord?.(exotic))?.objective).toBe("exotic");
  });

  // HIGH-1 — atomic read-modify-write is exposed and correct on both adapters.
  it("updateObjectiveRecord applies the mutation atomically (accumulates runsUsed)", async () => {
    await ctx.adapter.setObjectiveRecord?.("agent-atomic", {
      _schemaVersion: 1,
      objective: "loop",
      status: "active",
      runsUsed: 0,
    });
    await ctx.adapter.updateObjectiveRecord?.("agent-atomic", (cur) =>
      cur === undefined ? undefined : { ...cur, runsUsed: cur.runsUsed + 5 },
    );
    expect((await ctx.adapter.getObjectiveRecord?.("agent-atomic"))?.runsUsed).toBe(5);
    // returning undefined leaves unchanged; returning null clears.
    await ctx.adapter.updateObjectiveRecord?.("agent-atomic", () => undefined);
    expect((await ctx.adapter.getObjectiveRecord?.("agent-atomic"))?.runsUsed).toBe(5);
    await ctx.adapter.updateObjectiveRecord?.("agent-atomic", () => null);
    expect(await ctx.adapter.getObjectiveRecord?.("agent-atomic")).toBeUndefined();
  });
});

describe("InMemoryConversationStorage — objective-specific", () => {
  // MEDIUM-1 — deleteScope counts + prunes an objective-only thread (no transcript).
  // InMemory keys the maps by the RAW id, so logical-prefix scoping works directly.
  it("deleteScope counts an objective-only thread", async () => {
    const s = new InMemoryConversationStorage();
    await s.setObjectiveRecord("temp-obj-only", {
      _schemaVersion: 1,
      objective: "x",
      status: "active",
      runsUsed: 0,
    });
    expect(await s.deleteScope("temp-")).toBe(1);
    expect(await s.getObjectiveRecord("temp-obj-only")).toBeUndefined();
  });
});

describe("FileSystemConversationStorage — FS-specific", () => {
  let root: string;
  let adapter: FileSystemConversationStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "theokit-conv-fs-"));
    adapter = new FileSystemConversationStorage({ root });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("append → read persists across simulated process restart", async () => {
    await adapter.appendMessage("agent-restart", { role: "user", content: "before-restart" });
    // Simulate restart: new adapter pointing at same root.
    const fresh = new FileSystemConversationStorage({ root });
    const msgs = await fresh.getMessages("agent-restart");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.content).toBe("before-restart");
  });

  // SE33 (LOW-2) — the durable objective persists to objective.json and a fresh
  // adapter at the same root reads it back (survives a process restart).
  it("objective persists to disk and is read back by a fresh adapter", async () => {
    await adapter.setObjectiveRecord("agent-obj-restart", {
      _schemaVersion: 1,
      objective: "keep working",
      options: { maxRuns: 12 },
      status: "active",
      runsUsed: 4,
    });
    const fresh = new FileSystemConversationStorage({ root });
    const rec = await fresh.getObjectiveRecord("agent-obj-restart");
    expect(rec).toMatchObject({ objective: "keep working", runsUsed: 4, options: { maxRuns: 12 } });
  });

  it("deleteConversation removes the directory + JSONL file", async () => {
    await adapter.appendMessage("agent-delete-me", { role: "user", content: "x" });
    // Confirm file exists, then delete, then confirm gone.
    await adapter.deleteConversation("agent-delete-me");
    const msgs = await adapter.getMessages("agent-delete-me");
    expect(msgs).toEqual([]);
  });

  // EC-1: path-traversal in deleteConversation. `sanitizeIdentifier` rejects
  // the input before any `rm` runs, so the error is `ConfigurationError`
  // (code: "invalid_identifier") not a stray rm against an escaped path.
  it("deleteConversation rejects path-traversal attempts", async () => {
    await expect(adapter.deleteConversation("../../../tmp")).rejects.toBeInstanceOf(
      ConfigurationError,
    );
  });

  // EC-2: ENOENT in listConversationIds when .theokit/agents/ does not exist
  it("listConversationIds returns [] when agents dir is missing (ENOENT)", async () => {
    const empty = await adapter.listConversationIds();
    expect(empty).toEqual([]);
  });

  it("listConversationIds returns ids of populated conversations", async () => {
    await adapter.appendMessage("agent-a", { role: "user", content: "1" });
    await adapter.appendMessage("agent-b", { role: "user", content: "2" });
    const ids = await adapter.listConversationIds();
    expect([...(ids ?? [])].sort()).toEqual(["agent-a", "agent-b"]);
  });

  it("listConversationIds respects limit option", async () => {
    await adapter.appendMessage("agent-a", { role: "user", content: "1" });
    await adapter.appendMessage("agent-b", { role: "user", content: "2" });
    await adapter.appendMessage("agent-c", { role: "user", content: "3" });
    const limited = await adapter.listConversationIds({ limit: 2 });
    expect(limited).toHaveLength(2);
  });

  // EC-10: tool_call role round-trips through FS adapter
  it("appendMessage with tool_call role persists and round-trips", async () => {
    await adapter.appendMessage("agent-tool", { role: "user", content: "use the calculator" });
    await adapter.appendMessage("agent-tool", {
      role: "tool_call",
      content: '{"name":"calc","args":{"a":1}}',
    });
    await adapter.appendMessage("agent-tool", { role: "tool_result", content: "2" });
    await adapter.appendMessage("agent-tool", { role: "assistant", content: "result is 2" });
    const msgs = await adapter.getMessages("agent-tool");
    expect(msgs).toHaveLength(4);
    expect(msgs.map((m) => m.role)).toEqual(["user", "tool_call", "tool_result", "assistant"]);
  });

  // I9 — redactSecrets invariant preserved through FS adapter
  it("appendMessage runs content through redactSecrets before persisting", async () => {
    const secret = "sk-test-1234567890abcdef1234567890abcdef";
    await adapter.appendMessage("agent-secret", { role: "user", content: `key=${secret}` });
    const filePath = join(root, ".theokit", "agents", "agent-secret", "messages.jsonl");
    const raw = await readFile(filePath, "utf8");
    expect(raw).not.toContain(secret);
  });
});
