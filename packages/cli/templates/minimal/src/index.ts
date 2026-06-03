/**
 * {{projectName}} — a minimal @theokit/sdk agent.
 *
 * Sends one prompt, streams the reply, exits.
 */

import { Agent } from "@theokit/sdk";

const API_KEY = process.env.THEOKIT_API_KEY ?? "local";
const MODEL = process.env.AGENT_MODEL ?? "anthropic/claude-3-5-sonnet-latest";

async function main(): Promise<void> {
  const agent = await Agent.create({
    apiKey: API_KEY,
    model: { id: MODEL },
    local: { cwd: process.cwd() },
    systemPrompt: "You are a helpful assistant. Reply in one short sentence.",
  });

  console.log(`Agent: ${agent.agentId} · Model: ${MODEL}`);
  const run = await agent.send("Tell me a one-sentence fun fact about TypeScript.");

  process.stdout.write("\n");
  for await (const event of run.stream()) {
    if (event.type === "assistant") {
      for (const part of event.message.content) {
        if (part.type === "text") process.stdout.write(part.text);
      }
    }
  }
  await run.wait();
  process.stdout.write("\n");
}

main().catch((cause) => {
  console.error("agent failed:", cause instanceof Error ? cause.message : cause);
  process.exit(1);
});
