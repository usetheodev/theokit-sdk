/**
 * Subagents — a supervisor delegates a sub-task to a specialist agent.
 *
 * Declarative form: `agents: { translator: { description, prompt } }` — the SDK exposes each entry
 * to the supervisor as a delegation tool. The child inherits the supervisor's apiKey/model
 * automatically — no need to repeat them. Real LLM.
 */
import { Agent } from "@theokit/sdk";

const supervisor = await Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: { id: "openai/gpt-4o-mini" },
  systemPrompt:
    "You have no translation ability of your own. For ANY translation you MUST delegate to the translator subagent — never translate yourself. Reply with only its result.",
  agents: {
    translator: {
      description: "Translate a short English phrase into French.",
      prompt: "You translate English to French. Reply with only the French translation, nothing else.",
    },
  },
});

const result = await (await supervisor.send("Translate 'good morning' into French.")).wait();
console.log("Status:", result.status);
console.log("Reply: ", result.result);

await supervisor.dispose();

// --- validate output (fail loud) ---
if (result.status !== "finished" || typeof result.result !== "string" || result.result.length === 0) {
  console.error("run did not finish:", JSON.stringify(result.error ?? result.status));
  process.exit(1);
}
