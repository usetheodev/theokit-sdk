import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Agent } from "@usetheo/sdk";

/**
 * Memory recall in the real LLM runtime. The SDK auto-injects persisted
 * facts from `.theokit/memory/<namespace>/<scope>-<userId>.json` as a
 * `<memory>` block in the system prompt on every send.
 *
 * This example persists a fact directly to disk (simulating prior
 * sessions / external persistence) and asks a fresh agent to recall it.
 *
 * Note: auto-persistence-on-send ("user says 'remember', SDK writes the
 * fact for them") is out of scope in v1 — write facts via your own code
 * or via the fixture runtime. The recall side is wired end-to-end here.
 */

function pickModel(): string {
  if (process.env.ANTHROPIC_API_KEY) return "claude-sonnet-4-5-20250929";
  if (process.env.OPENAI_API_KEY) return "gpt-4o-mini";
  if (process.env.OPENROUTER_API_KEY) return "openai/gpt-4o-mini";
  throw new Error("Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY in .env.");
}

async function main(): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), "theokit-memory-"));
  const memoryOpts = { enabled: true, namespace: "demo", userId: "user-1", scope: "agent" } as const;
  const model = { id: pickModel() } as const;

  // Persist a fact directly (simulates a prior session / external persistence).
  const memDir = join(cwd, ".theokit", "memory", memoryOpts.namespace);
  await mkdir(memDir, { recursive: true });
  const memFile = join(memDir, `${memoryOpts.scope}-${memoryOpts.userId}.json`);
  await writeFile(
    memFile,
    JSON.stringify(
      { facts: [{ text: "The magic-number for this workspace is 8675309." }] },
      null,
      2,
    ),
  );
  console.log(`Persisted fact to ${memFile}`);

  // A fresh agent automatically recalls the persisted fact via the
  // <memory> block injected into its system prompt.
  const agent = await Agent.create({
    apiKey: process.env.THEOKIT_API_KEY ?? "user-real-example-key",
    model,
    local: { cwd, settingSources: ["project"] },
    memory: memoryOpts,
    systemPrompt: "Answer using only the facts in your memory.",
  });
  const result = await (await agent.send("What is the magic-number for this workspace?")).wait();
  console.log(`\n[${agent.agentId}] status=${result.status}`);
  console.log(`[${agent.agentId}] said: ${result.result}`);
  await agent.dispose();
}

main().catch((cause) => {
  console.error("memory failed:", cause);
  process.exit(1);
});
