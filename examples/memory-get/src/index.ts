import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Agent } from "@usetheo/sdk";

/**
 * Demonstrates the `memory_get` tool — bounded read by path + line range.
 * Path traversal outside `.theokit/memory/` is rejected (EC-2 of edge-case
 * review).
 */

function pickModel(): string {
  if (process.env.ANTHROPIC_API_KEY) return "claude-sonnet-4-5-20250929";
  if (process.env.OPENAI_API_KEY) return "gpt-4o-mini";
  if (process.env.OPENROUTER_API_KEY) return "google/gemini-2.0-flash-001";
  throw new Error("Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY in .env.");
}

async function main(): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), "theokit-memget-"));
  await mkdir(join(cwd, ".theokit", "memory", "notes"), { recursive: true });
  await writeFile(
    join(cwd, ".theokit", "memory", "MEMORY.md"),
    "# Memory\n\n## Facts\n\n- See `notes/deploy.md` for the deploy runbook.\n",
    "utf8",
  );
  await writeFile(
    join(cwd, ".theokit", "memory", "notes", "deploy.md"),
    [
      "# Deploy runbook",
      "",
      "## Production deploy",
      "",
      "Step 1: run `pnpm build`",
      "Step 2: run `pnpm deploy:prod`",
      "Step 3: verify the Slack channel #ops-alerts shows the new release",
      "",
      "## Rollback",
      "",
      "Step 1: `pnpm rollback` (rolls back to the previous tag)",
      "Step 2: notify in #incidents",
      "",
    ].join("\n"),
    "utf8",
  );

  const agent = await Agent.create({
    apiKey: process.env.THEOKIT_API_KEY ?? "user-real-example-key",
    model: { id: pickModel() },
    local: { cwd, settingSources: ["project"] },
    memory: { enabled: true },
    systemPrompt:
      "You have access to memory_search and memory_get. To read a specific file by path, call memory_get with `path: 'notes/deploy.md'`. Bounded reads are safe — try to find the exact deploy steps when asked.",
  });

  const run = await agent.send("Read notes/deploy.md and tell me the rollback procedure.");
  const result = await run.wait();
  console.log(`[${agent.agentId}] status=${result.status}`);
  console.log(`[${agent.agentId}] said: ${result.result}`);
  await agent.dispose();
}

main().catch((cause) => {
  console.error("memory-get failed:", cause);
  process.exit(1);
});
