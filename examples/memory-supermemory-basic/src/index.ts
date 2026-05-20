/**
 * memory-supermemory-basic — end-to-end demo of @usetheo/memory-supermemory.
 *
 * Writes 3 facts, recalls a query, asks the LLM about them, deletes facts.
 * Validates that:
 *   - agent.memory.write / recall round-trips against real Supermemory.
 *   - pre_user_send hook injects recalled context into the LLM call so the
 *     reply references the persisted facts.
 *
 * Requires SUPERMEMORY_API_KEY + OPENROUTER_API_KEY in .env.
 */

import { Agent } from "@usetheo/sdk";
import { supermemoryMemory } from "@usetheo/memory-supermemory";

const SUPERMEMORY_API_KEY = process.env.SUPERMEMORY_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

async function main(): Promise<void> {
  // EC-M: error messages name the missing var by literal name.
  if (!SUPERMEMORY_API_KEY) {
    throw new Error("Set SUPERMEMORY_API_KEY in .env");
  }
  if (!OPENROUTER_API_KEY) {
    throw new Error("Set OPENROUTER_API_KEY in .env");
  }

  // EC-S: unique containerTagPrefix per run keeps test data isolated.
  const runPrefix = `theokit-example-${Date.now()}`;

  const agent = await Agent.create({
    apiKey: OPENROUTER_API_KEY,
    model: { id: "openai/gpt-4o-mini" },
    local: {},
    plugins: [
      supermemoryMemory({ apiKey: SUPERMEMORY_API_KEY, containerTagPrefix: runPrefix }),
    ] as unknown as import("@usetheo/sdk").AgentOptions["plugins"],
    memoryContext: { userId: "demo-user" },
  });

  console.log(`Using containerTagPrefix=${runPrefix}\n`);

  // Write 3 facts via direct API
  const id1 = await agent.memory!.write("User likes Brazilian jazz");
  const id2 = await agent.memory!.write("User is learning TypeScript");
  const id3 = await agent.memory!.write("User has a cat named Mochi");
  console.log(`Wrote 3 facts: ${id1}, ${id2}, ${id3}\n`);

  // Recall
  const facts = await agent.memory!.recall("music preferences", undefined, 5);
  console.log(`Recalled (k=5) for "music preferences":`);
  for (const f of facts) console.log(`  - [${f.score?.toFixed(2) ?? "?"}] ${f.content}`);
  console.log();

  // LLM-driven flow: ask via send + verify recall context is injected.
  // The pre_user_send hook runs Supermemory recall under the hood.
  const run = await agent.send(
    "Based on what you know about the user, what music would they enjoy?",
  );
  const result = await run.wait();
  console.log("LLM reply:\n", result.result);

  // Cleanup
  await agent.memory!.delete(id1);
  await agent.memory!.delete(id2);
  await agent.memory!.delete(id3);
  console.log("\nCleanup: 3 facts deleted.");

  await agent.dispose();
}

main().catch((err) => {
  console.error("memory-supermemory-basic failed:", err);
  process.exitCode = 1;
});
