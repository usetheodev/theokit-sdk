/**
 * Prompts and instructions (features/prompts).
 *
 * The system prompt is the agent's instructions. It can be a plain string, a
 * resolver evaluated per send (with the message + context), or overridden for a
 * single send via `SendOptions.systemPrompt`.
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

// Dynamic instructions: the system prompt is computed per send from context
// (`ctx.userMessage`, `ctx.model`, recalled `ctx.memory`, …).
const agent = await Agent.create({
  apiKey,
  model: { id: "openai/gpt-4o-mini" },
  systemPrompt: (ctx) =>
    `You are a terse assistant. Answer in exactly one sentence. The user asked: "${ctx.userMessage}".`,
});

const dynamic = await (await agent.send("What is TypeScript?")).wait();
console.log("Dynamic:  ", dynamic.result);

// Per-send override: a string that wins over the resolver for this send only.
const override = await (
  await agent.send("What is TypeScript?", { systemPrompt: "Reply as a pirate, in one sentence." })
).wait();
console.log("Override: ", override.result);

await agent.dispose();

// --- validate output (fail loud) ---
for (const [label, r] of [["dynamic", dynamic], ["override", override]] as const) {
  if (r.status !== "finished" || typeof r.result !== "string" || r.result.length === 0) {
    console.error(`${label} run did not finish:`, JSON.stringify(r.error ?? r.status));
    process.exit(1);
  }
}
