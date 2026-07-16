/**
 * Providers and models (features/providers-models).
 *
 * The model is chosen by the `vendor/model` id you pass to `Agent.create` plus
 * the key. `@theokit/sdk/models` also gives you offline helpers to parse a model
 * id and look up its capabilities — no key, no network.
 *
 * Run:
 *   pnpm install
 *   export OPENROUTER_API_KEY=sk-or-...   # or put it in .env
 *   pnpm run run
 */

import { Agent } from "@theokit/sdk";
import { humanizeModelName, parseModelId, resolveModelCapabilities } from "@theokit/sdk/models";

const apiKey = process.env.OPENROUTER_API_KEY;
if (apiKey === undefined || apiKey.length === 0) {
  throw new Error("Set OPENROUTER_API_KEY (env or .env) — see https://openrouter.ai/keys");
}

// 1. Inspect any model id — offline, pure, no network.
const inspectId = "anthropic/claude-3-5-sonnet";
const { provider, name } = parseModelId(inspectId);
const caps = resolveModelCapabilities(inspectId);
console.log(`Inspect:  ${humanizeModelName(inspectId)}`);
console.log(`Provider: ${provider}  ·  name: ${name}`);
console.log(`Context:  ${caps.maxContextTokens} tokens  ·  tools: ${caps.supportsToolUse}  ·  vision: ${caps.supportsVision}`);

// 2. Run an agent. The `vendor/model` id + your key route to the provider
//    (here OpenRouter routes `openai/…`).
const agent = await Agent.create({
  apiKey,
  model: { id: "openai/gpt-4o-mini" },
  systemPrompt: "You are concise.",
});
const result = await (await agent.send("Name three popular LLM providers, comma-separated.")).wait();
console.log(`\nReply:    ${result.result}`);

await agent.dispose();

// --- validate output (fail loud) ---
if (result.status !== "finished" || typeof result.result !== "string" || result.result.length === 0) {
  console.error("run did not finish:", JSON.stringify(result.error ?? result.status));
  process.exit(1);
}
