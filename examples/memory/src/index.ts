import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Agent } from "@usetheo/sdk";

/**
 * Persistent memory across agent restarts. The SDK auto-writes a fact when
 * the user types "Remember: <fact>" (memory.enabled === true) and
 * auto-injects every persisted fact as a `<memory>` block in the system
 * prompt of subsequent sends.
 *
 * Two agents on the same workspace share the same memory file — the second
 * agent recalls what the first one was asked to remember.
 */

function pickModel(): string {
  if (process.env.ANTHROPIC_API_KEY) return "claude-sonnet-4-5-20250929";
  if (process.env.OPENAI_API_KEY) return "gpt-4o-mini";
  if (process.env.OPENROUTER_API_KEY) return "google/gemini-2.0-flash-001";
  throw new Error("Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY in .env.");
}

async function main(): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), "theokit-memory-"));
  const memoryOpts = { enabled: true, namespace: "demo", userId: "user-1", scope: "agent" } as const;
  const model = { id: pickModel() } as const;

  // Agent #1: says "Remember: …" — SDK persists the fact to disk before the LLM call.
  {
    const a1 = await Agent.create({
      apiKey: process.env.THEOKIT_API_KEY ?? "user-real-example-key",
      model,
      local: { cwd, settingSources: ["project"] },
      memory: memoryOpts,
      systemPrompt:
        "You are an assistant with persistent memory. When the user says 'Remember: <fact>', acknowledge it.",
    });
    const r1 = await (await a1.send("Remember: the magic-number for this workspace is 8675309.")).wait();
    console.log(`[agent-1 ${a1.agentId}] said: ${r1.result}`);
    await a1.dispose();
  }

  // Agent #2: fresh handle, same workspace — recalls the persisted fact via
  // the auto-injected <memory> block.
  {
    const a2 = await Agent.create({
      apiKey: process.env.THEOKIT_API_KEY ?? "user-real-example-key",
      model,
      local: { cwd, settingSources: ["project"] },
      memory: memoryOpts,
      systemPrompt: "Answer using only the facts in your memory.",
    });
    const r2 = await (await a2.send("What is the magic-number for this workspace?")).wait();
    console.log(`\n[agent-2 ${a2.agentId} same workspace] status=${r2.status}`);
    console.log(`[agent-2] said: ${r2.result}`);
    await a2.dispose();
  }

  console.log(`\nMemory file lives under: ${cwd}/.theokit/memory/`);
}

main().catch((cause) => {
  console.error("memory failed:", cause);
  process.exit(1);
});
