/**
 * Tools — give an agent a typed tool (features/tools).
 *
 * `Tool.create` turns a plain async function into a tool the model can call. The
 * Zod `inputSchema` is converted to JSON Schema and validated before `execute`
 * runs, so the arguments are typed. The agent decides when to call it based on
 * the description and the user's message.
 *
 * Run:
 *   pnpm install
 *   export OPENROUTER_API_KEY=sk-or-...   # or put it in .env
 *   pnpm run run
 */

import { Agent, Tool } from "@theokit/sdk";
import { z } from "zod";

const apiKey = process.env.OPENROUTER_API_KEY;
if (apiKey === undefined || apiKey.length === 0) {
  throw new Error("Set OPENROUTER_API_KEY (env or .env) — see https://openrouter.ai/keys");
}

const getWeather = Tool.create({
  name: "get_weather",
  description: "Look up the current weather in a given city.",
  inputSchema: z.object({
    city: z.string().describe("City name, e.g. 'Tokyo' or 'Brasília'."),
  }),
  async handler({ city }) {
    // A real tool would call a weather API. Mocked here so the example is self-contained.
    const mock: Record<string, string> = {
      Tokyo: "18°C, cloudy",
      Brasília: "27°C, sunny",
      London: "12°C, raining",
    };
    return mock[city] ?? `No weather data for ${city}.`;
  },
});

const agent = await Agent.create({
  apiKey,
  model: { id: "openai/gpt-oss-120b:free" },
  name: "weather-bot",
  systemPrompt: "Use the get_weather tool when the user asks about weather. Answer in one sentence.",
  tools: [getWeather],
  local: { cwd: process.cwd(), sandboxOptions: { enabled: false } },
});

const run = await agent.send("What's the weather in Tokyo?");
const result = await run.wait();

console.log("Status:", result.status);
console.log("Reply: ", result.result);

await agent.dispose();
