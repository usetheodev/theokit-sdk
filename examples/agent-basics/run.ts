/**
 * Agents — creating and running an agent (features/agents).
 *
 * The smallest end-to-end path: create a local agent against your own provider
 * key, send one message, await the full result, dispose.
 *
 * Run:
 *   pnpm install
 *   export OPENROUTER_API_KEY=sk-or-...   # or put it in .env
 *   pnpm run run
 */

import { Agent } from "@theokit/sdk";

const apiKey = process.env.OPENROUTER_API_KEY;
if (apiKey === undefined || apiKey.length === 0) {
  throw new Error("Set OPENROUTER_API_KEY (env or .env) — see https://openrouter.ai/keys");
}

const agent = await Agent.create({
  apiKey,
  model: { id: "meta-llama/llama-3.3-70b-instruct:free" },
  name: "explainer-bot",
  systemPrompt: "You are a concise assistant. Answer in at most two sentences.",
  // Local runtime, no sandbox — runs inline in this Node process.
  local: { cwd: process.cwd(), sandboxOptions: { enabled: false } },
});

const run = await agent.send("What is an AI agent? Answer for a developer.");
const result = await run.wait();

console.log("Status:", result.status);
console.log("Model: ", result.model);
console.log("Reply: ", result.result);

await agent.dispose();

// Validate: a run that did not finish (auth, rate-limit, model error) is a failure, not a green run.
if (result.status !== "finished" || typeof result.result !== "string" || result.result.length === 0) {
  console.error("run did not finish:", JSON.stringify(result.error ?? result.status));
  process.exit(1);
}
