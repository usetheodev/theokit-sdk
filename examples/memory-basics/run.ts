/**
 * Memory basics — the agent remembers across turns.
 *
 * `memory: { enabled: true }` turns on the built-in memory store (under `cwd`). The agent persists
 * what it's told and recalls it on a later turn, auto-injecting the relevant fact into context —
 * so the second turn answers correctly without you re-stating it.
 */
import { Agent } from "@theokit/sdk";

const agent = await Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: { id: "openai/gpt-oss-120b:free" },
  local: { cwd: "./.memory" },   // where the memory store lives
  memory: { enabled: true },
  systemPrompt: "You are concise. Recall from memory when asked.",
});

// Turn 1 — tell the agent a fact.
const t1 = await (await agent.send("Remember this fact: my project's deploy command is 'make ship'.")).wait();
console.log("Turn 1:", t1.status);

// Turn 2 — a fresh question; memory recalls the fact.
const t2 = await (await agent.send("What is my project's deploy command? Answer with just the command.")).wait();
console.log("Turn 2:", t2.status);
console.log("Recalled:", t2.result);

await agent.dispose();
