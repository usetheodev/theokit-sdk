/**
 * Goals — a durable, thread-scoped objective. Deterministic: setObjective/getObjective persist to
 * conversation storage (no LLM). The runUntil() judge loop that consumes the objective needs a model.
 */
import { Agent, InMemoryConversationStorage } from "@theokit/sdk";

const agent = await Agent.create({
  apiKey: "theo_test_goals",               // fixture key — no LLM for storage ops
  model: { id: "openai/gpt-4o-mini" },
  conversationStorage: new InMemoryConversationStorage(),
});

await agent.setObjective?.("Ship a green test suite", { threadId: "t1", maxRuns: 5 });

const rec = await agent.getObjective?.({ threadId: "t1" });
console.log("objective:", rec?.objective);
console.log("status:   ", rec?.status);
console.log("maxRuns:  ", rec?.options?.maxRuns);
console.log("runsUsed: ", rec?.runsUsed);

await agent.clearObjective?.({ threadId: "t1" });
console.log("after clear:", await agent.getObjective?.({ threadId: "t1" }));

await agent.dispose?.();
