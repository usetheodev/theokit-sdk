/**
 * TheoKit Telegram Bot — gateway + agent + memory pattern.
 *
 * Demonstrates GatewayRunner with TelegramAdapter, per-user agent
 * instances via createAgentFactory, and streaming reply collection.
 *
 * Requires: @theokit/gateway, @theokit/gateway-telegram, grammy
 */

import { GatewayRunner } from "@theokit/gateway";
import { TelegramAdapter } from "@theokit/gateway-telegram";
import { createAgentFactory } from "@theokit/sdk";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN missing. Create a bot via @BotFather and set the env var.");
  process.exit(1);
}

const API_KEY = process.env.THEOKIT_API_KEY ?? "local";
const MODEL = process.env.AGENT_MODEL ?? "anthropic/claude-3-5-sonnet-latest";

// 1. Create a factory that provisions one agent per Telegram user.
const factory = createAgentFactory({
  apiKey: API_KEY,
  model: { id: MODEL },
  systemPrompt:
    "You are a helpful Telegram assistant. Keep replies concise " +
    "(1-2 sentences). Use plain text, no markdown.",
  local: { cwd: process.cwd() },
});

// 2. Set up the Telegram adapter.
const adapter = new TelegramAdapter({ token: TELEGRAM_BOT_TOKEN });

// 3. Helper to collect a streamed reply into a string.
async function collectReply(
  run: Awaited<ReturnType<Awaited<ReturnType<typeof factory.getOrCreate>>["send"]>>,
): Promise<string> {
  let reply = "";
  for await (const event of run.stream()) {
    if (event.type !== "assistant") continue;
    for (const part of event.message.content) {
      if (part.type === "text") reply += part.text;
    }
  }
  await run.wait();
  return reply;
}

// 4. Wire the gateway runner: route each inbound message to a per-user agent.
const runner = new GatewayRunner({
  adapters: [adapter],
  handler: async (event, ctx) => {
    if (event.text.length === 0) return;

    const agentId = `telegram-${event.sender.id}`;
    const agent = await factory.getOrCreate(agentId);
    const run = await agent.send(event.text);
    const reply = await collectReply(run);

    if (reply.length > 0) {
      await ctx.reply(reply);
    }
  },
});

// 5. Start and handle graceful shutdown.
await runner.start();
console.log("Telegram bot started. Send a message to your bot.");

process.on("SIGINT", async () => {
  await runner.stop();
  process.exit(0);
});
