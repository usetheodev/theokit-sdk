import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Agent } from "@usetheo/sdk";

/**
 * Demonstrates the `memory_search` tool (Phase 6 of memory-system-openclaw-parity).
 *
 * The SDK opens an FTS5-indexed SQLite at `.theokit/memory/.index/memory.sqlite`
 * and registers `memory_search` + `memory_get` with the LLM when memory is
 * enabled. The LLM calls the tool with a query string and gets ranked
 * `{ path, startLine, endLine, score, snippet, citation }` hits back.
 */

function pickModel(): string {
  if (process.env.ANTHROPIC_API_KEY) return "claude-sonnet-4-5-20250929";
  if (process.env.OPENAI_API_KEY) return "gpt-4o-mini";
  if (process.env.OPENROUTER_API_KEY) return "google/gemini-2.0-flash-001";
  throw new Error("Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY in .env.");
}

async function main(): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), "theokit-memsearch-"));
  await mkdir(join(cwd, ".theokit", "memory"), { recursive: true });
  // Seed the memory corpus with a handful of facts the model can search through.
  await writeFile(
    join(cwd, ".theokit", "memory", "MEMORY.md"),
    [
      "# Memory",
      "",
      "## Facts",
      "",
      "- The magic-number for this workspace is 8675309.",
      "- The user prefers Vitest as the test runner.",
      "- The user's favorite color is teal.",
      "- The deploy command is `pnpm deploy:prod`.",
      "- The Slack channel for incidents is #ops-alerts.",
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
      "You have access to the memory_search tool. When asked a factual question, ALWAYS call memory_search first to find the answer in stored facts, then summarize what you found.",
  });

  const run = await agent.send("What's the magic-number? Use memory_search to find it.");
  const result = await run.wait();
  console.log(`[${agent.agentId}] status=${result.status}`);
  console.log(`[${agent.agentId}] said: ${result.result}`);
  await agent.dispose();
}

main().catch((cause) => {
  console.error("memory-search failed:", cause);
  process.exit(1);
});
