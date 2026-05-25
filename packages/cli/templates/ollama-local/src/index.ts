/**
 * {{projectName}} — 100% local agent via Ollama (ADR D182).
 *
 * Zero remote API keys required. Boots Ollama (must be running locally),
 * pre-warms the model, sends a prompt, streams the reply.
 */

import { Agent } from "@usetheo/sdk";

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "ollama/llama3.2:3b";

async function main(): Promise<void> {
  const agent = await Agent.create({
    apiKey: process.env.THEOKIT_API_KEY ?? "local",
    model: { id: MODEL },
    local: { cwd: process.cwd() },
    systemPrompt:
      "You are a concise assistant. Respond in one or two short sentences. No greetings.",
  });

  console.log(`Agent: ${agent.agentId}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Host:  ${OLLAMA_HOST}\n`);

  const run = await agent.send("Explain what dependency injection is, in one sentence.");

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
  const message = cause instanceof Error ? cause.message : String(cause);
  console.error("ollama agent failed:", message);
  if (/ollama_unreachable|ECONNREFUSED/.test(message)) {
    console.error("\nHint: run `ollama serve` to start the local runtime,");
    console.error("or set OLLAMA_HOST to point at a remote Ollama box.");
  }
  process.exit(1);
});
