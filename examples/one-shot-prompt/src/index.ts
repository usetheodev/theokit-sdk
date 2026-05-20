import { Agent } from "@usetheo/sdk";

/**
 * One-shot prompt example. Demonstrates `Agent.prompt()` — the
 * create+send+wait+dispose convenience — plus the `await using`
 * pattern for explicit resource cleanup.
 *
 * Notice there's no `await agent.send()` boilerplate: `Agent.prompt`
 * folds the entire lifecycle into a single call.
 */

function pickModel(): string {
  if (process.env.ANTHROPIC_API_KEY) return "claude-sonnet-4-5-20250929";
  if (process.env.OPENAI_API_KEY) return "gpt-4o-mini";
  if (process.env.OPENROUTER_API_KEY) return "openai/gpt-4o-mini";
  throw new Error("Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY in .env.");
}

async function oneShot(): Promise<void> {
  const result = await Agent.prompt("Reply with exactly: pong", {
    apiKey: process.env.THEOKIT_API_KEY ?? "user-real-example-key",
    model: { id: pickModel() },
    local: { cwd: process.cwd() },
    systemPrompt: "You are a low-latency echo bot. Reply with the exact text requested. No commentary.",
  });
  console.log(`[one-shot] status=${result.status} result=${JSON.stringify(result.result)}`);
}

async function awaitUsingPattern(): Promise<void> {
  await using agent = await Agent.create({
    apiKey: process.env.THEOKIT_API_KEY ?? "user-real-example-key",
    model: { id: pickModel() },
    local: { cwd: process.cwd() },
  });
  console.log(`[await-using] agent ${agent.agentId} created`);
  const run = await agent.send("Reply with exactly: hello again");
  const result = await run.wait();
  console.log(`[await-using] status=${result.status} result=${JSON.stringify(result.result)}`);
  // No explicit `agent.close()` — the `await using` block disposes on scope exit.
}

async function main(): Promise<void> {
  await oneShot();
  await awaitUsingPattern();
}

main().catch((cause) => {
  console.error("one-shot-prompt failed:", cause);
  process.exit(1);
});
