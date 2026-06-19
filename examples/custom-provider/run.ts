/**
 * Custom LLM provider via `defineProvider`.
 *
 * Demonstrates:
 * - Declare a `ProviderProfile` for any OpenAI-compatible endpoint (here: Groq).
 * - Build a `kind: "model-provider"` plugin with `defineProvider`.
 * - Route to it via the `provider/model` id prefix on `Agent.create`.
 *
 * Real-LLM validation (per .claude/rules/real-llm-validation.md):
 *   The custom-provider REGISTRATION + ROUTING is demonstrated without a live
 *   call (no key needed). To actually send, set a real Groq key:
 *     GROQ_API_KEY=gsk_... pnpm run
 */

import { Agent, defineProvider } from "@theokit/sdk";

const groqKey = process.env.GROQ_API_KEY;
const realLlm = typeof groqKey === "string" && groqKey.startsWith("gsk_");

console.log("\n== Custom provider via defineProvider ==");
console.log(realLlm ? "Mode: real Groq call" : "Mode: registration/routing only (no key)");

// 1. Declare the provider — data only. OpenAI-compatible → apiMode "chat_completions".
const groq = defineProvider({
  name: "groq",
  apiMode: "chat_completions",
  authType: realLlm ? "api_key" : "none",
  envVars: ["GROQ_API_KEY"],
  baseUrl: "https://api.groq.com/openai/v1",
  fallbackModels: ["groq/llama-3.1-8b-instant"],
  aliases: ["groq-cloud"],
});

console.log(`Provider plugin: name=${groq.name} kind=${groq.kind}`);

// 2. Create an agent routed to the custom provider via the `groq/...` id prefix.
const agent = await Agent.create({
  model: { id: "groq/llama-3.1-8b-instant" },
  plugins: [groq],
});

console.log(`Agent created (id=${agent.id}) routing to the custom provider.`);

if (realLlm) {
  const run = await agent.send("Reply with exactly: custom provider works");
  const result = await run.wait();
  console.log(`status=${result.status}`);
  console.log(`reply=${result.result ?? "(none)"}`);
} else {
  console.log("Set GROQ_API_KEY=gsk_... to perform a live send.");
}

await agent.dispose();
console.log("Done.\n");
