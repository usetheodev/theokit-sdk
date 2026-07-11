import { afterEach, describe, expect, it } from "vitest";

import { Agent } from "../src/agent.js";
import { InMemoryConversationStorage } from "../src/internal/persistence/conversation-storage-memory.js";
import { clearAllSessions } from "../src/internal/runtime/session/agent-session.js";

/**
 * SE33 (ADR 0012) — the durable-objective Agent methods end-to-end:
 * setObjective persists via the ConversationStorageAdapter; a FRESH agent
 * sharing the same adapter reads it back (durability contract); update / clear;
 * no-op when the adapter cannot persist.
 */

const KEY = "theo_test_objective_methods";
const MODEL = { id: "openai/gpt-4o-mini" };

afterEach(() => {
  clearAllSessions();
});

describe("SE33 — Agent durable-objective methods", () => {
  it("setObjective persists; a FRESH agent on the SAME adapter reads it back (survives reload)", async () => {
    const storage = new InMemoryConversationStorage();
    const a1 = await Agent.create({ apiKey: KEY, model: MODEL, conversationStorage: storage });
    await a1.setObjective?.("Add and test a /health endpoint", { threadId: "t1", maxRuns: 40 });

    // A brand-new agent instance (simulating a reload) sharing the same durable
    // adapter must see the objective — proving it lives in storage, not the agent.
    const a2 = await Agent.create({ apiKey: KEY, model: MODEL, conversationStorage: storage });
    const rec = await a2.getObjective?.({ threadId: "t1" });
    expect(rec?.objective).toBe("Add and test a /health endpoint");
    expect(rec?.options).toEqual({ maxRuns: 40 });
    expect(rec?.status).toBe("active");
    expect(rec?.runsUsed).toBe(0);
  });

  it("updateObjectiveOptions merges; clearObjective drops it", async () => {
    const storage = new InMemoryConversationStorage();
    const agent = await Agent.create({ apiKey: KEY, model: MODEL, conversationStorage: storage });
    await agent.setObjective?.("Ship", { threadId: "t1", maxRuns: 10 });
    await agent.updateObjectiveOptions?.({ threadId: "t1", judgeModel: "openai/gpt-4o-mini" });

    const merged = await agent.getObjective?.({ threadId: "t1" });
    expect(merged?.options).toEqual({ maxRuns: 10, judgeModel: "openai/gpt-4o-mini" });

    await agent.clearObjective?.({ threadId: "t1" });
    expect(await agent.getObjective?.({ threadId: "t1" })).toBeUndefined();
  });

  it("objectives are per-thread (distinct threadIds do not collide)", async () => {
    const storage = new InMemoryConversationStorage();
    const agent = await Agent.create({ apiKey: KEY, model: MODEL, conversationStorage: storage });
    await agent.setObjective?.("goal A", { threadId: "tA" });
    await agent.setObjective?.("goal B", { threadId: "tB" });
    expect((await agent.getObjective?.({ threadId: "tA" }))?.objective).toBe("goal A");
    expect((await agent.getObjective?.({ threadId: "tB" }))?.objective).toBe("goal B");
  });

  it("setObjective rejects a non-positive maxRuns (fail-fast validation, LOW-3)", async () => {
    const storage = new InMemoryConversationStorage();
    const agent = await Agent.create({ apiKey: KEY, model: MODEL, conversationStorage: storage });
    await expect(agent.setObjective?.("x", { threadId: "t1", maxRuns: 0 })).rejects.toThrow(
      /maxRuns/,
    );
    await expect(agent.setObjective?.("x", { threadId: "t1", maxRuns: -5 })).rejects.toThrow(
      /maxRuns/,
    );
    // Nothing was persisted for the invalid calls.
    expect(await agent.getObjective?.({ threadId: "t1" })).toBeUndefined();
  });

  it("no-op (never throws) when the adapter cannot persist objectives", async () => {
    // A custom adapter WITHOUT getObjectiveRecord/setObjectiveRecord.
    const bare = {
      getMessages: async () => [],
      appendMessage: async () => {},
      deleteConversation: async () => {},
    };
    const agent = await Agent.create({ apiKey: KEY, model: MODEL, conversationStorage: bare });
    await expect(agent.setObjective?.("x", { threadId: "t1" })).resolves.toBeUndefined();
    await expect(agent.getObjective?.({ threadId: "t1" })).resolves.toBeUndefined();
  });
});
