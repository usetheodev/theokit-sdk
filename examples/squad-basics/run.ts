/**
 * Squad basics — a sequential team of agents.
 *
 * `Squad.create({ agents })` runs its agents in array order: each agent's reply becomes the next
 * agent's input. Here a brainstormer proposes name ideas, then a picker chooses the best one.
 * `squad.run(input)` returns the terminal `SquadRun` — `result` (last agent's output), `status`,
 * and `steps` (one `StepResult` per agent).
 */
import { Agent, Squad } from "@theokit/sdk";

const brainstormer = await Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: { id: "openai/gpt-oss-120b:free" },
  systemPrompt: "List exactly 3 short product name ideas as a comma-separated line. No preamble.",
});

const picker = await Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: { id: "openai/gpt-oss-120b:free" },
  systemPrompt: "From the given list, pick the single best name and reply with just that name and a 6-word reason.",
});

const squad = Squad.create({ agents: [brainstormer, picker] });

const run = await squad.run("a focus timer app for developers");

console.log("Status:", run.status);
console.log("Steps:", run.steps.length);
console.log("Result:", run.result);

await brainstormer.dispose();
await picker.dispose();
