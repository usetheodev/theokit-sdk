import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Agent } from "@usetheo/sdk";

/**
 * Demonstrates the 3 Active Memory queryMode variants:
 *
 *   - "message"  — search uses only the current user message
 *   - "recent"   — search includes the last N user turns + current message
 *   - "full"     — search includes the entire conversation history
 *
 * "message" is the fastest (small query, no history). "recent" gives
 * context-aware recall without ballooning the query. "full" is the
 * most thorough but most expensive.
 *
 * Each mode runs the same agent twice — first send seeds context, second
 * send asks a question whose answer requires recalling the seeded fact.
 */

function pickModel(): string {
  if (process.env.ANTHROPIC_API_KEY) return "claude-sonnet-4-5-20250929";
  if (process.env.OPENAI_API_KEY) return "gpt-4o-mini";
  if (process.env.OPENROUTER_API_KEY) return "google/gemini-2.0-flash-001";
  throw new Error("Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY in .env.");
}

async function runMode(mode: "message" | "recent" | "full"): Promise<void> {
  console.log(`\n=== queryMode: "${mode}" ===`);
  const cwd = await mkdtemp(join(tmpdir(), `theokit-amqm-${mode}-`));
  await mkdir(join(cwd, ".theokit", "memory"), { recursive: true });
  await writeFile(
    join(cwd, ".theokit", "memory", "MEMORY.md"),
    [
      "# Memory",
      "",
      "## Facts",
      "",
      "- The magic-number for this workspace is 8675309.",
      "- The fallback magic-number for staging is 4815162342.",
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
      index: { tools: false },
      activeRecall: { enabled: true, queryMode: mode, maxSummaryChars: 400, timeoutMs: 15000 },
    },
    systemPrompt:
      "Answer the user's question using ONLY the facts in your active memory block.",
  });

  // Seed conversation history so "recent"/"full" have something to consider.
  await (await agent.send("Hi, I'm starting a new project.")).wait();
  await (await agent.send("Help me set up CI.")).wait();
  const run = await agent.send("What's the production magic-number?");
  const result = await run.wait();
  console.log(`[${mode}] status=${result.status}`);
  console.log(`[${mode}] said: ${result.result}`);
  await agent.dispose();
}

async function main(): Promise<void> {
  for (const mode of ["message", "recent", "full"] as const) {
    try {
      await runMode(mode);
    } catch (cause) {
      console.error(`[${mode}] failed:`, cause);
    }
  }
}

main().catch((cause) => {
  console.error("active-memory-query-modes failed:", cause);
  process.exit(1);
});
