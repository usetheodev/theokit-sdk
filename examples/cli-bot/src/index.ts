import { userInfo } from "node:os";
import { createInterface } from "node:readline/promises";

import { createAgentFactory, type CustomTool, defineTool } from "@usetheo/sdk";
import { z } from "zod";

/**
 * cli-bot — second chat-bot example (ADR D36). Proves DX portability of
 * the 4 helpers (`createAgentFactory` + `Agent.getOrCreate` via the factory
 * + `defineTool` + optional builder) outside the Telegram-pro shape.
 *
 * Persistence: each user gets `cli-bot-${username}` agent on disk under
 * `.theokit/agents/`. Restart preserves memory + session history.
 *
 * Run: `pnpm dev` → type messages at the prompt → `/exit` to quit.
 *
 * Set BOT_BANNER=quiet to skip the welcome banner (useful for CI smoke).
 */

function pickModel(): string {
  if (process.env.ANTHROPIC_API_KEY) return "claude-sonnet-4-5-20250929";
  if (process.env.OPENAI_API_KEY) return "gpt-4o-mini";
  if (process.env.OPENROUTER_API_KEY) return "openai/gpt-4o-mini";
  throw new Error("Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY in .env.");
}

// defineTool — type-safe custom tool the agent can call.
const tools: CustomTool[] = [
  defineTool({
    name: "current_time",
    description: "Return the host's current UTC time as ISO-8601.",
    inputSchema: z.object({}),
    handler: () => new Date().toISOString(),
  }),
];

const factory = createAgentFactory({
  apiKey: process.env.THEOKIT_API_KEY ?? "user-real-example-key",
  model: { id: pickModel() },
  local: { cwd: process.cwd(), sandboxOptions: { enabled: true } },
  tools,
  systemPrompt:
    "You are a terminal assistant. Respond in 1-3 sentences. If asked the time, call the current_time tool.",
});

const username = userInfo().username || "anonymous";
const agentId = `cli-bot-${username}`;

const banner = process.env.BOT_BANNER === "quiet"
  ? ""
  : `\nCLI bot ready (agent: ${agentId}). Type a message and press Enter. /exit to quit.\n`;
if (banner.length > 0) process.stdout.write(banner);

const agent = await factory.getOrCreate(agentId, {
  memory: {
    enabled: true,
    namespace: "cli-bot",
    scope: "user",
    userId: username,
    activeRecall: { enabled: true, queryMode: "recent" },
  },
});

// If CI_SMOKE=1, run a single canned exchange and exit. Otherwise
// interactive REPL.
if (process.env.CI_SMOKE === "1") {
  const run = await agent.send("In one word, say hi.");
  const result = await run.wait();
  process.stdout.write(`${result.result ?? "(no result)"}\n`);
  await agent.dispose();
  process.exit(0);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
try {
  while (true) {
    let text: string;
    try {
      text = (await rl.question("> ")).trim();
    } catch {
      // stdin closed (EOF) — exit cleanly.
      break;
    }
    if (text.length === 0) continue;
    if (text === "/exit") break;
    const run = await agent.send(text);
    const result = await run.wait();
    process.stdout.write(`${result.result ?? `(run ${result.status})`}\n\n`);
  }
} finally {
  rl.close();
  await agent.dispose();
}
