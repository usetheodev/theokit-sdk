/**
 * Goals (v4.0) — the ephemeral `runUntil` judge loop.
 *
 * `agent.runUntil(goal, options)` drives `send()` in a loop: after each turn an auxiliary judge model
 * decides `done` vs `continue`, until the goal is met or `maxTurns` is hit. It is an async generator —
 * iterate the `GoalEvent`s, and the generator's final value is a `GoalResult`.
 *
 * v4.0 note: `runUntil` is now EXCLUSIVELY the ephemeral, explicit-goal loop. The durable,
 * thread-scoped objective surface (`setObjective` / `getObjective` / `clearObjective`) was removed.
 *
 * Requires a real LLM (the judge loop calls a model):
 *   OPENROUTER_API_KEY=sk-or-... pnpm run
 */
import { Agent } from "@theokit/sdk";

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey?.startsWith("sk-or-")) {
  console.log("Set OPENROUTER_API_KEY=sk-or-... to run this example (real LLM required for the judge loop).");
  process.exit(0);
}

const agent = await Agent.create({
  apiKey,
  model: { id: "openai/gpt-4o-mini" },
  systemPrompt: "You are a concise assistant. Do exactly what is asked, one step at a time.",
  providers: { routes: [{ capability: "chat" as const, provider: "openrouter" }] },
});

// Explicit goal → ephemeral loop. No goal would pause (there is no durable objective to resolve).
const loop = agent.runUntil?.(
  "List the first 3 prime numbers, one per line, then say the word DONE.",
  { maxTurns: 4 },
);
if (!loop) {
  console.error("runUntil unavailable on this runtime");
  process.exit(1);
}

let ev = await loop.next();
while (!ev.done) {
  const e = ev.value;
  if (e.type === "turn_start") console.log(`  turn ${e.turn} → send`);
  else if (e.type === "judge_verdict") console.log(`  turn ${e.turn} → judge: ${e.verdict} (${e.reason.slice(0, 60)})`);
  else if (e.type === "status_change") console.log(`  status: ${e.status}`);
  ev = await loop.next();
}
const result = ev.value; // GoalResult

console.log("goal status:  ", result.status);
console.log("turns used:   ", result.turnsUsed);
console.log("final answer: ", result.finalResponse?.slice(0, 120));

await agent.dispose();

// --- validate: the loop reached a terminal state (fail loud) ---
if (result.status === "failed") {
  console.error("runUntil failed to reach the goal");
  process.exit(1);
}
console.log("OK — ephemeral runUntil judge loop reached a terminal state.");
