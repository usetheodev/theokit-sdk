/**
 * memory-mem0-basic — demonstrates Mem0's unique `history(id)` capability.
 *
 * Requires MEM0_API_KEY + OPENROUTER_API_KEY in .env.
 */

import { Agent, type MemoryId } from "@usetheo/sdk";
import { mem0Memory } from "@usetheo/memory-mem0";

const MEM0_API_KEY = process.env.MEM0_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

async function main(): Promise<void> {
  // EC-M
  if (!MEM0_API_KEY) throw new Error("Set MEM0_API_KEY in .env");
  if (!OPENROUTER_API_KEY) throw new Error("Set OPENROUTER_API_KEY in .env");

  const userId = `demo-${Date.now()}`;

  const agent = await Agent.create({
    apiKey: OPENROUTER_API_KEY,
    model: { id: "openai/gpt-4o-mini" },
    local: {},
    plugins: [mem0Memory({ apiKey: MEM0_API_KEY })] as unknown as import(
      "@usetheo/sdk"
    ).AgentOptions["plugins"],
    memoryContext: { userId },
  });

  console.log(`Using userId=${userId}\n`);

  const id1: MemoryId = await agent.memory!.write("User prefers pop music");
  console.log(`Wrote fact ${id1}`);

  // Update the fact (Mem0 extracts new memory, may create a new id)
  const id2: MemoryId = await agent.memory!.write(
    "User now prefers Brazilian jazz instead of pop",
  );
  console.log(`Wrote update ${id2}`);

  // History: Mem0-unique capability — show fact evolution
  const adapter = agent.memory!.adapter();
  if (adapter !== null && adapter.capabilities.history === true && adapter.history !== undefined) {
    const revisions = await adapter.history(id1);
    console.log(`\nHistory of ${id1}:`);
    for (const r of revisions) {
      console.log(`  v${r.version} [${r.changedAt}]: ${r.content}`);
    }
  }

  // Recall returns the LATEST extracted facts
  const facts = await agent.memory!.recall("music preferences");
  console.log(`\nRecalled (latest):`);
  for (const f of facts) console.log(`  - [${f.score?.toFixed(2) ?? "?"}] ${f.content}`);

  await agent.dispose();
}

main().catch((err) => {
  console.error("memory-mem0-basic failed:", err);
  process.exitCode = 1;
});
