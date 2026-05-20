/**
 * memory-honcho-basic — end-to-end demo of @usetheo/memory-honcho.
 *
 * Writes 3 turns, recalls a dialectic reasoning answer (Honcho's
 * differentiator: ONE synthesized answer, not k facts — EC-J).
 *
 * Requires HONCHO_API_KEY + OPENROUTER_API_KEY in .env.
 */

import { Agent } from "@usetheo/sdk";
import { honchoMemory } from "@usetheo/memory-honcho";

const HONCHO_API_KEY = process.env.HONCHO_API_KEY;
const HONCHO_WORKSPACE_ID = process.env.HONCHO_WORKSPACE_ID;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

async function main(): Promise<void> {
  // EC-M: name the missing var literally.
  if (!HONCHO_API_KEY) throw new Error("Set HONCHO_API_KEY in .env");
  if (!OPENROUTER_API_KEY) throw new Error("Set OPENROUTER_API_KEY in .env");

  const userId = `demo-${Date.now()}`;

  const agent = await Agent.create({
    apiKey: OPENROUTER_API_KEY,
    model: { id: "openai/gpt-4o-mini" },
    local: {},
    plugins: [
      honchoMemory({
        apiKey: HONCHO_API_KEY,
        ...(HONCHO_WORKSPACE_ID !== undefined ? { workspaceId: HONCHO_WORKSPACE_ID } : {}),
      }),
    ] as unknown as import("@usetheo/sdk").AgentOptions["plugins"],
    memoryContext: { userId },
  });

  console.log(`Using userId=${userId}\n`);

  // Persist 3 turns
  await agent.memory!.write("User likes Brazilian jazz");
  await agent.memory!.write("User is learning TypeScript");
  await agent.memory!.write("User has a cat named Mochi");
  console.log("Wrote 3 turns.\n");

  // Honcho recall returns ONE synthesized reasoning answer (EC-J)
  const facts = await agent.memory!.recall(
    "What does this user enjoy and what are they learning?",
  );
  console.log("Recalled (dialectic answer):");
  for (const f of facts) console.log(`  > ${f.content}`);
  console.log();

  // LLM via agent.send — pre_user_send hook injects Honcho's reasoning.
  const run = await agent.send("Suggest a song the user might enjoy.");
  const result = await run.wait();
  console.log("LLM reply:\n", result.result);

  await agent.dispose();
}

main().catch((err) => {
  console.error("memory-honcho-basic failed:", err);
  process.exitCode = 1;
});
