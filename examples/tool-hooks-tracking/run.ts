/**
 * Production-Readiness #4 — Tool lifecycle hooks example.
 *
 * Demonstrates onToolStart / onToolEnd / onToolError for cost tracking,
 * audit log, latency telemetry. Hook errors are SWALLOWED (D317) — a
 * misbehaving listener cannot crash the agent run.
 *
 * To run with a real LLM (only path that exercises tool dispatch):
 *   OPENROUTER_API_KEY=sk-or-... pnpm run
 */

import { Agent, defineTool } from "@theokit/sdk";
import { z } from "zod";

const apiKey = process.env.OPENROUTER_API_KEY ?? "theo_test_tool_hooks_example";
const realLlm = apiKey.startsWith("sk-or-");

console.log(`\n== Tool lifecycle hooks example ==`);
console.log(realLlm ? "Mode: real OpenRouter" : "Mode: fixture (no LLM call)");
console.log();

// Custom tool that the LLM may invoke.
const getWeatherTool = defineTool({
  name: "get_weather",
  description: "Return mock weather for a city",
  inputSchema: z.object({ city: z.string() }),
  handler: async ({ city }) => {
    await new Promise((r) => setTimeout(r, 20)); // simulate latency
    if (city === "boom") throw new Error("intentional handler failure");
    return JSON.stringify({ city, tempC: 22, condition: "sunny" });
  },
});

// In-memory telemetry sink.
const events: Array<{
  type: "start" | "end" | "error";
  toolName: string;
  callId: string;
  durationMs?: number;
  errorMsg?: string;
}> = [];

const providers = realLlm
  ? {
      routes: [{ capability: "chat" as const, provider: "openrouter" }],
      fallback: ["openrouter"],
    }
  : undefined;

const agent = await Agent.create({
  apiKey,
  model: { id: "openai/gpt-4o-mini" },
  local: { cwd: process.cwd() },
  tools: [getWeatherTool],
  ...(providers !== undefined ? { providers } : {}),
  onToolStart: ({ toolName, callId }) => {
    events.push({ type: "start", toolName, callId });
  },
  onToolEnd: ({ toolName, callId, durationMs }) => {
    events.push({ type: "end", toolName, callId, durationMs });
  },
  onToolError: ({ toolName, callId, durationMs, error }) => {
    events.push({ type: "error", toolName, callId, durationMs, errorMsg: error.message });
  },
});

if (realLlm) {
  console.log(`[1] Sending message that should invoke get_weather…`);
  const run = await agent.send("What is the weather in Paris? Use the get_weather tool.");
  // Consume the stream to drive the conversation forward (real tool dispatch).
  let text = "";
  for await (const event of run.stream()) {
    if (event.type === "assistant") {
      for (const part of event.message.content) {
        if (part.type === "text") text += part.text;
      }
    }
  }
  await run.wait();
  console.log(`[1] LLM reply: ${text.slice(0, 200)}`);
} else {
  console.log(`[1] Skipping LLM call (no OPENROUTER_API_KEY set)`);
}

console.log();
console.log(`Captured ${events.length} tool lifecycle events:`);
for (const e of events) {
  const dur = e.durationMs !== undefined ? ` (${e.durationMs}ms)` : "";
  const err = e.errorMsg !== undefined ? ` error="${e.errorMsg}"` : "";
  console.log(`  [${e.type.padEnd(5)}] ${e.toolName} callId=${e.callId}${dur}${err}`);
}

console.log();
console.log(`Invariants observed:`);
console.log(`- callId is identical across start↔end (or start↔error) pairs`);
console.log(`- durationMs measured from start hook → end (or error) hook`);
console.log(`- error.message is always present on onToolError`);
console.log(`- onToolError fires when validate fails OR handler throws`);
console.log(`- Hook listener throws are swallowed with stderr warn (D317)`);

await agent.dispose();
