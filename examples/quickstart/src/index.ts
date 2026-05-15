import { Agent } from "@usetheo/sdk";

/**
 * Quickstart — the smallest possible @usetheo/sdk program.
 *
 * Creates a local agent, sends one prompt, streams the events as they
 * arrive, and prints the final assistant text. Requires a real provider
 * key in `.env` (Anthropic, OpenAI, or OpenRouter).
 */

function pickModel(): string {
  if (process.env.ANTHROPIC_API_KEY) return "claude-sonnet-4-5-20250929";
  if (process.env.OPENAI_API_KEY) return "gpt-4o-mini";
  if (process.env.OPENROUTER_API_KEY) return "openai/gpt-4o-mini";
  throw new Error(
    "No provider key found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY in .env.",
  );
}

async function main(): Promise<void> {
  const agent = await Agent.create({
    apiKey: process.env.THEOKIT_API_KEY ?? "user-real-example-key",
    model: { id: pickModel() },
    local: { cwd: process.cwd() },
  });
  console.log(`Agent: ${agent.agentId}`);

  const run = await agent.send(
    "Greet me in one sentence and tell me what year you think it is.",
  );

  for await (const event of run.stream()) {
    if (event.type === "assistant") {
      const text = event.message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
      console.log(`\n${text}`);
    }
  }

  const result = await run.wait();
  console.log(`\n[status=${result.status} duration=${result.durationMs}ms]`);
}

main().catch((cause) => {
  console.error("Quickstart failed:", cause);
  process.exit(1);
});
