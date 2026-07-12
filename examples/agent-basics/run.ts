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
  model: { id: "openai/gpt-4o-mini" },
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
if (result.status === "error") {
  console.error("Error: ", JSON.stringify(result.error, null, 2));
}

await agent.dispose();
