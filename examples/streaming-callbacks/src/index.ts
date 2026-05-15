import { Agent } from "@usetheo/sdk";

/**
 * SendOptions onStep + onDelta callbacks. Receives finer-grained
 * lifecycle signal than `run.stream()` — `onDelta` fires per raw
 * `InteractionUpdate` (token-by-token text, tool-call args streaming
 * in, thinking deltas), and `onStep` fires when a logical step
 * (assistantText / thinking / toolBatch) finishes.
 *
 * Useful when building progress bars, real-time UIs, or
 * fine-grained observability.
 */

function pickModel(): string {
  if (process.env.ANTHROPIC_API_KEY) return "claude-sonnet-4-5-20250929";
  if (process.env.OPENAI_API_KEY) return "gpt-4o-mini";
  if (process.env.OPENROUTER_API_KEY) return "openai/gpt-4o-mini";
  throw new Error("Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY in .env.");
}

async function main(): Promise<void> {
  const agent = await Agent.create({
    apiKey: process.env.THEOKIT_API_KEY ?? "user-real-example-key",
    model: { id: pickModel() },
    local: { cwd: process.cwd() },
    systemPrompt: "Answer concisely in 2-3 sentences.",
  });

  let stepCount = 0;
  let deltaCount = 0;
  const run = await agent.send("Briefly explain what a system prompt does in three sentences.", {
    onStep: ({ step }) => {
      stepCount += 1;
      console.log(`[step ${stepCount}] type=${step.type}`);
    },
    onDelta: ({ update }) => {
      deltaCount += 1;
      if (deltaCount <= 3 || deltaCount % 20 === 0) {
        console.log(`[delta ${deltaCount}] type=${update.type}`);
      }
    },
  });
  const result = await run.wait();
  console.log(`\nTotal steps: ${stepCount}, total deltas: ${deltaCount}`);
  console.log(`Final result: ${result.result}`);
}

main().catch((cause) => {
  console.error("streaming-callbacks failed:", cause);
  process.exit(1);
});
