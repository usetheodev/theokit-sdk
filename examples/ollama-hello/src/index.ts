/**
 * Ollama Hello — minimal end-to-end @usetheo/sdk demo against a local
 * Ollama runtime (ADR D182).
 *
 * Run:
 *   1. Install Ollama:  https://ollama.com/download
 *   2. Pull a model:    ollama pull llama3.2:3b
 *   3. Start daemon:    ollama serve   (or it auto-runs on macOS app launch)
 *   4. Run the example: pnpm start
 *
 * No API key required — the SDK ships Ollama as a builtin provider with
 * `authType: "none"`. Set THEOKIT_API_KEY to any non-empty string only
 * because the SDK requires one at construction (used for cloud catalog,
 * not for the Ollama call).
 */

import { Agent } from "@usetheo/sdk";

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
  console.log(`Model: ${MODEL}\n`);

  const run = await agent.send("Say a one-sentence fun fact about TypeScript.");

  // Stream tokens as they arrive.
  let answer = "";
  for await (const event of run.stream()) {
    if (event.type === "assistant") {
      for (const part of event.message.content) {
        if (part.type === "text") {
          process.stdout.write(part.text);
          answer += part.text;
        }
      }
    }
  }
  await run.wait();
  if (answer.length === 0) console.log("(empty response — model may need a longer prompt)");
  console.log("\n");
}

main().catch((cause) => {
  console.error("ollama-hello failed:", cause instanceof Error ? cause.message : cause);
  process.exit(1);
});
