/**
 * Hooks — observe the agent's tool lifecycle with the onToolStart / onToolEnd / onToolError callbacks.
 * The SET and ORDER of hooks that fire is deterministic (same lifecycle every run), even though the
 * model's reply varies. Real LLM: the model must call the tool for the lifecycle to run.
 */
import { Agent, Tool } from "@theokit/sdk";
import { z } from "zod";

const events: string[] = [];

const clock = Tool.create({
  name: "get_time",
  description: "Return the current time in a city.",
  inputSchema: z.object({ city: z.string() }),
  handler: ({ city }) => `12:00 in ${city}`,
});

const agent = await Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: { id: "openai/gpt-4o-mini" },
  systemPrompt: "You MUST call get_time for any time question. Answer in one line.",
  tools: [clock],
  onToolStart: ({ toolName }) => events.push(`onToolStart:${toolName}`),
  onToolEnd: ({ toolName, durationMs }) => events.push(`onToolEnd:${toolName}(${durationMs >= 0 ? "ok" : "?"})`),
  onToolError: ({ toolName }) => events.push(`onToolError:${toolName}`),
});

const result = await (await agent.send("What time is it in Tokyo?")).wait();
console.log("hooks fired:", events.join(" -> "));
console.log("status:     ", result.status);

await agent.dispose();

if (result.status !== "finished" || events.length === 0) {
  console.error("expected hooks to fire on a finished run:", JSON.stringify(result.error ?? result.status));
  process.exit(1);
}
