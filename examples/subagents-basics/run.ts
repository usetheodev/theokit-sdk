/**
 * Subagents — a supervisor delegates a sub-task to a specialist agent exposed as a tool.
 *
 * `SubAgent.create(spec)` turns an agent definition into a CustomTool. The supervisor decides when
 * to call it; the child runs in isolation and its answer flows back as the tool result. Real LLM.
 */
import { Agent } from "@theokit/sdk";
import { SubAgent } from "@theokit/sdk/a2a";

const translator = SubAgent.create({
  name: "translator",
  description: "Translate a short English phrase into French.",
  instructions: "You translate English to French. Reply with only the French translation, nothing else.",
  // The subagent needs its own model — it routes to OpenRouter, which reads OPENROUTER_API_KEY.
  model: "openai/gpt-4o-mini",
});

const supervisor = await Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: { id: "openai/gpt-4o-mini" },
  systemPrompt: "When the user asks for a translation, delegate it to the translator tool. Answer in one line.",
  tools: [translator],
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
