import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Agent } from "@usetheo/sdk";

/**
 * Demonstrates Active Memory (Phase 7) — when `memory.activeRecall.enabled`
 * is true, the SDK runs a blocking pre-send recall and prepends the result
 * as an `<active-memory>` block at the top of the LLM system prompt.
 *
 * The main agent doesn't need to call any tool — relevant facts arrive
 * pre-injected. Circuit breaker (3 timeouts → 60s cooldown) + 15s TTL cache
 * make repeated sends fast.
 */

function pickModel(): string {
  if (process.env.ANTHROPIC_API_KEY) return "claude-sonnet-4-5-20250929";
  if (process.env.OPENAI_API_KEY) return "gpt-4o-mini";
  if (process.env.OPENROUTER_API_KEY) return "google/gemini-2.0-flash-001";
  throw new Error("Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY in .env.");
}

async function main(): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), "theokit-active-"));
  await mkdir(join(cwd, ".theokit", "memory"), { recursive: true });
  await writeFile(
    join(cwd, ".theokit", "memory", "MEMORY.md"),
    [
      "# Memory",
      "",
      "## Facts",
      "",
      "- The magic-number for this workspace is 8675309.",
      "- The user prefers Vitest as the test runner.",
      "- Production deploys go through `pnpm deploy:prod`.",
      "",
    ].join("\n"),
    "utf8",
  );

  const agent = await Agent.create({
    apiKey: process.env.THEOKIT_API_KEY ?? "user-real-example-key",
    model: { id: pickModel() },
    local: { cwd, settingSources: ["project"] },
    memory: {
      enabled: true,
      // No tool calls needed — Active Memory pre-recalls relevant facts and
      // prepends them to the system prompt.
      index: { tools: false },
      activeRecall: {
        enabled: true,
        queryMode: "message",
        maxSummaryChars: 400,
        timeoutMs: 10000,
      },
    },
    systemPrompt:
      "Answer the user's question using ONLY the facts in your active memory block. If the answer is not in memory, say so.",
  });

  const run = await agent.send("What's the magic-number?");
  const result = await run.wait();
  console.log(`[${agent.agentId}] status=${result.status}`);
  console.log(`[${agent.agentId}] said: ${result.result}`);
  await agent.dispose();
}

main().catch((cause) => {
  console.error("active-memory failed:", cause);
  process.exit(1);
});
