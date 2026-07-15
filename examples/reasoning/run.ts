/**
 * Reasoning — `reasoning: true` turns a non-reasoning model into a reason -> act
 * -> observe loop (SE37). The agent gets a chain-of-thought preamble + the
 * `think`/`analyze` tools auto-attached (same model), so it thinks step by step
 * before answering.
 *
 * Proves the mechanism against a REAL LLM: the classic "9.11 vs 9.9" trap that a
 * non-reasoning model often gets wrong (comparing digit-by-digit). With
 * `reasoning: true` the model calls the `think` tool and answers correctly.
 *
 * Run:
 *   export OPENROUTER_API_KEY=sk-or-...   # or repo-root .env
 *   pnpm run run
 */

import { Agent } from "@theokit/sdk";

const apiKey = process.env.OPENROUTER_API_KEY;
if (apiKey === undefined || apiKey.length === 0) {
  throw new Error("Set OPENROUTER_API_KEY (env or .env) — see https://openrouter.ai/keys");
}

const toolCalls: string[] = [];

const agent = await Agent.create({
  apiKey,
  model: { id: "openai/gpt-4o-mini" }, // a NON-reasoning model — reasoning:true does the work
  reasoning: true, // ← SE37: CoT preamble + think/analyze auto-attached
  local: { cwd: process.cwd(), sandboxOptions: { enabled: false } },
  onToolStart: (e) => {
    toolCalls.push(e.toolName);
  },
});

const run = await agent.send(
  "Which is bigger: 9.11 or 9.9? Think it through, then answer with just the number.",
);
const result = await run.wait();

console.log("status:", result.status);
console.log("model: ", result.model);
console.log("tools called:", toolCalls.join(", ") || "(none)");
console.log("reply: ", result.result);

await agent.dispose();

// Validate — the mechanism engaged AND the answer is correct (9.9 > 9.11).
const reply = typeof result.result === "string" ? result.result : "";
const failures: string[] = [];
if (result.status !== "finished") failures.push(`run did not finish: ${result.status}`);
if (!toolCalls.some((n) => /think/i.test(n))) {
  failures.push(`the think tool was not called (tools: ${toolCalls.join(", ") || "none"})`);
}
if (!/9\.9(\b|0)/.test(reply) || /9\.11/.test(reply.replace(/9\.9\d*/g, ""))) {
  failures.push(`reply did not conclude 9.9 is bigger (reply: ${JSON.stringify(reply)})`);
}
if (failures.length > 0) {
  console.error("VALIDATION FAILED:", failures.join("; "));
  process.exit(1);
}
console.log("\nOK — reasoning:true drove the think tool + the correct answer (9.9 > 9.11).");
