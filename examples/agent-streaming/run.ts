/**
 * Agents — streaming a run (features/agents/streaming).
 *
 * `agent.send()` returns a `Run`. Instead of `await run.wait()` for the whole
 * result, iterate `run.stream()` to consume `SDKMessage` events as they arrive.
 * The stream is a discriminated union of full messages:
 *   - "system"    — run init metadata
 *   - "user"      — the submitted message, echoed back
 *   - "assistant" — model output; `.message.content` is (text | tool_use) blocks
 *   - "tool_call" — a tool the model invoked
 *   - "thinking"  — reasoning content (when the model emits it)
 *
 * Run:
 *   pnpm install
 *   export OPENROUTER_API_KEY=sk-or-...   # or put it in .env
 *   pnpm run run
 */

import { Agent } from "@theokit/sdk";

const apiKey = process.env.OPENROUTER_API_KEY;
if (apiKey === undefined || apiKey.length === 0) {
  throw new Error("Set OPENROUTER_API_KEY (env or .env) — see https://openrouter.ai/keys");
}

const agent = await Agent.create({
  apiKey,
  model: { id: "openai/gpt-4o-mini" },
  name: "streamer-bot",
  systemPrompt: "You are a concise storyteller.",
  local: { cwd: process.cwd(), sandboxOptions: { enabled: false } },
});

const run = await agent.send("Tell me a two-sentence story about a curious robot.");

for await (const msg of run.stream()) {
  switch (msg.type) {
    case "assistant":
      for (const block of msg.message.content) {
        if (block.type === "text") process.stdout.write(block.text);
        else if (block.type === "tool_use") console.log(`\n[tool_use] ${block.name}`);
      }
      break;
    case "tool_call":
      console.log(`\n[calling tool] ${msg.name}`);
      break;
    default:
      // "system" | "user" | "thinking" | "status" | … — ignored here.
      break;
  }
}

// After the stream drains, wait() resolves to the terminal RunResult.
const result = await run.wait();
console.log(`\n\n[done] status=${result.status}`);

await agent.dispose();
