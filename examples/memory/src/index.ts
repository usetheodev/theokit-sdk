import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Agent } from "@usetheo/sdk";

/**
 * Persistent memory across agent restarts. The SDK writes durable
 * facts under `.theokit/memory/<scope>.json` when `memory: { enabled: true }`.
 *
 * This example creates an agent, asks it to "remember" something,
 * disposes the agent, then creates a NEW agent against the same
 * workspace and verifies the fact was persisted (the new agent
 * recalls it).
 */

function pickModel(): string {
  if (process.env.ANTHROPIC_API_KEY) return "claude-sonnet-4-5-20250929";
  if (process.env.OPENAI_API_KEY) return "gpt-4o-mini";
  if (process.env.OPENROUTER_API_KEY) return "openai/gpt-4o-mini";
  throw new Error("Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY in .env.");
}

async function main(): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), "theokit-memory-"));
  const memoryOpts = { enabled: true, namespace: "demo", userId: "user-1", scope: "global" } as const;
  const model = { id: pickModel() } as const;

  // First agent: remembers something.
  {
    const a1 = await Agent.create({
      apiKey: process.env.THEOKIT_API_KEY ?? "user-real-example-key",
      model,
      local: { cwd, settingSources: ["project"] },
      memory: memoryOpts,
      systemPrompt:
        "You are an assistant with persistent memory. When the user says 'Remember: <fact>', acknowledge it. Otherwise answer questions using only what you've been told to remember.",
    });
    const r1 = await (await a1.send("Remember: the magic-number for this workspace is 8675309.")).wait();
    console.log(`[agent-1 ${a1.agentId}] said: ${r1.result}`);
    await a1.dispose();
  }

  // Second agent: same workspace, asks for the fact.
  {
    const a2 = await Agent.create({
      apiKey: process.env.THEOKIT_API_KEY ?? "user-real-example-key",
      model,
      local: { cwd, settingSources: ["project"] },
      memory: memoryOpts,
      systemPrompt:
        "You are an assistant with persistent memory. Answer using only the facts in your memory.",
    });
    const r2 = await (await a2.send("What is the magic-number for this workspace?")).wait();
    console.log(`\n[agent-2 ${a2.agentId} same workspace] said: ${r2.result}`);
    await a2.dispose();
  }

  console.log(`\nMemory file lives under: ${cwd}/.theokit/memory/`);
}

main().catch((cause) => {
  console.error("memory failed:", cause);
  process.exit(1);
});
