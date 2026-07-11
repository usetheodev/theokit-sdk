import { describe, expect, it } from "vitest";

import { InMemoryConversationStorage } from "../src/internal/persistence/conversation-storage-memory.js";
import {
  clearObjective,
  getObjective,
  setObjective,
  updateObjectiveOptions,
  writeObjectiveProgress,
} from "../src/internal/runtime/objective/objective-store.js";
import type { ConversationStorageAdapter } from "../src/types/conversation-storage.js";

/**
 * SE33 (ADR 0012) — the pure durable-objective store over a
 * `ConversationStorageAdapter`. Persist / read / update / clear a thread-scoped
 * objective; no-op (typed degradation) when the adapter omits the optional
 * `getObjectiveRecord`/`setObjectiveRecord` methods.
 */

describe("SE33 — objective store over ConversationStorage", () => {
  it("setObjective persists a fresh active record (schemaVersion 1, runsUsed 0)", async () => {
    const s = new InMemoryConversationStorage();
    await setObjective(s, "t1", "Add a /health endpoint", { maxRuns: 30 });
    const rec = await getObjective(s, "t1");
    expect(rec).toEqual({
      _schemaVersion: 1,
      objective: "Add a /health endpoint",
      options: { maxRuns: 30 },
      status: "active",
      runsUsed: 0,
    });
  });

  it("getObjective returns undefined for an unset thread", async () => {
    const s = new InMemoryConversationStorage();
    expect(await getObjective(s, "nope")).toBeUndefined();
  });

  it("updateObjectiveOptions merges only provided fields, keeps objective/status/runsUsed", async () => {
    const s = new InMemoryConversationStorage();
    await setObjective(s, "t1", "Ship it", { maxRuns: 10, judgeModel: "openai/gpt-4o-mini" });
    await writeObjectiveProgress(s, "t1", { runsUsed: 3, status: "active" });
    await updateObjectiveOptions(s, "t1", { maxRuns: 100 }); // only maxRuns changes

    const rec = await getObjective(s, "t1");
    expect(rec?.objective).toBe("Ship it");
    expect(rec?.options).toEqual({ maxRuns: 100, judgeModel: "openai/gpt-4o-mini" });
    expect(rec?.runsUsed).toBe(3); // progress preserved
    expect(rec?.status).toBe("active");
  });

  it("updateObjectiveOptions is a no-op when no objective is set", async () => {
    const s = new InMemoryConversationStorage();
    await updateObjectiveOptions(s, "t1", { maxRuns: 5 });
    expect(await getObjective(s, "t1")).toBeUndefined();
  });

  it("clearObjective removes the record", async () => {
    const s = new InMemoryConversationStorage();
    await setObjective(s, "t1", "temp");
    await clearObjective(s, "t1");
    expect(await getObjective(s, "t1")).toBeUndefined();
  });

  it("writeObjectiveProgress records runsUsed + status back (runUntil write-back)", async () => {
    const s = new InMemoryConversationStorage();
    await setObjective(s, "t1", "loop");
    await writeObjectiveProgress(s, "t1", { runsUsed: 20, status: "done" });
    const rec = await getObjective(s, "t1");
    expect(rec?.runsUsed).toBe(20);
    expect(rec?.status).toBe("done");
    expect(rec?.objective).toBe("loop"); // objective preserved
  });

  it("all ops no-op (never throw) when the adapter omits the objective methods", async () => {
    // A minimal adapter WITHOUT getObjectiveRecord/setObjectiveRecord.
    const bare: ConversationStorageAdapter = {
      getMessages: async () => [],
      appendMessage: async () => {},
      deleteConversation: async () => {},
    };
    await expect(setObjective(bare, "t1", "x")).resolves.toBeUndefined();
    await expect(getObjective(bare, "t1")).resolves.toBeUndefined();
    await expect(updateObjectiveOptions(bare, "t1", { maxRuns: 5 })).resolves.toBeUndefined();
    await expect(clearObjective(bare, "t1")).resolves.toBeUndefined();
    await expect(
      writeObjectiveProgress(bare, "t1", { runsUsed: 1, status: "active" }),
    ).resolves.toBeUndefined();
  });

  // HIGH-1 — when the adapter exposes the ATOMIC updateObjectiveRecord, the store's
  // read-modify-write ops route through it (the read cannot race the write).
  it("writeObjectiveProgress + updateObjectiveOptions route through the atomic updateObjectiveRecord when present", async () => {
    const calls: string[] = [];
    const inner = new InMemoryConversationStorage();
    const atomicSpy: ConversationStorageAdapter = {
      getMessages: (id, o) => inner.getMessages(id, o),
      appendMessage: (id, m) => inner.appendMessage(id, m),
      deleteConversation: (id) => inner.deleteConversation(id),
      getObjectiveRecord: (id) => inner.getObjectiveRecord(id),
      setObjectiveRecord: (id, r) => {
        calls.push("set");
        return inner.setObjectiveRecord(id, r);
      },
      updateObjectiveRecord: (id, mutate) => {
        calls.push("atomic");
        return inner.updateObjectiveRecord(id, mutate);
      },
    };
    await setObjective(atomicSpy, "t1", "loop", { maxRuns: 10 }); // uses setObjectiveRecord (fresh)
    await writeObjectiveProgress(atomicSpy, "t1", { runsUsed: 3, status: "active" });
    await updateObjectiveOptions(atomicSpy, "t1", { judgeModel: "m" });

    // The fresh set uses setObjectiveRecord; both read-modify-writes use the atomic path.
    expect(calls).toEqual(["set", "atomic", "atomic"]);
    const rec = await getObjective(atomicSpy, "t1");
    expect(rec).toMatchObject({ runsUsed: 3, options: { maxRuns: 10, judgeModel: "m" } });
  });
});
