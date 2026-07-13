/**
 * Agents — structured output (features/agents/structured-output).
 *
 * `agent.generate(message, { output: schema })` runs the normal tool loop, then
 * coerces the final answer into your Zod schema and returns a validated,
 * inferred-typed object. Under the hood the SDK forces a single synthetic tool
 * whose schema IS your Zod schema (ADR D33), then Zod-parses the result.
 *
 * Run:
 *   pnpm install
 *   export OPENROUTER_API_KEY=sk-or-...   # or put it in .env
 *   pnpm run run
 */

import { Agent } from "@theokit/sdk";
import { z } from "zod";

const apiKey = process.env.OPENROUTER_API_KEY;
if (apiKey === undefined || apiKey.length === 0) {
  throw new Error("Set OPENROUTER_API_KEY (env or .env) — see https://openrouter.ai/keys");
}

const Sentiment = z.object({
  sentiment: z.enum(["positive", "neutral", "negative"]),
  score: z.number().min(0).max(1).describe("Confidence between 0 and 1."),
  summary: z.string().describe("One short sentence summarizing the review."),
});

const agent = await Agent.create({
  apiKey,
  model: { id: "openai/gpt-4o-mini" },
  name: "review-analyzer",
  systemPrompt: "You analyze product reviews and return structured sentiment.",
  local: { cwd: process.cwd(), sandboxOptions: { enabled: false } },
});

const { object } = await agent.generate(
  "Review: 'The battery lasts two days and the screen is gorgeous, but it's pricey.'",
  { output: Sentiment },
);

// `object` is typed as { sentiment: "positive" | "neutral" | "negative"; score: number; summary: string }
console.log("sentiment:", object.sentiment);
console.log("score:    ", object.score);
console.log("summary:  ", object.summary);

await agent.dispose();

// --- validate output (fail loud) ---
if (!object || typeof object.sentiment !== "string") {
  console.error("structured output missing sentiment:", JSON.stringify(object));
  process.exit(1);
}
