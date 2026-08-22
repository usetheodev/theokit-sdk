/**
 * {{projectName}} — a Telegram bot powered by @theokit/sdk + @theokit/gateway.
 *
 * Boots a grammy bot, routes every inbound message through Agent.send,
 * streams the reply back to Telegram.
 */

import { GatewayRunner } from "@theokit/gateway";
import { TelegramAdapter } from "@theokit/gateway-telegram";
import { AgentFactory } from "@theokit/sdk";
import { Bot } from "grammy";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (TELEGRAM_BOT_TOKEN === undefined || TELEGRAM_BOT_TOKEN.length === 0) {
  console.error(
    "ABORT: TELEGRAM_BOT_TOKEN missing. Create a bot via @BotFather and add it to .env.",
  );
  process.exit(1);
}

const API_KEY = process.env.THEOKIT_API_KEY ?? "local";
const MODEL = process.env.AGENT_MODEL ?? "anthropic/claude-3-5-sonnet-latest";

const factory = AgentFactory.create({
  apiKey: API_KEY,
  model: { id: MODEL },
  local: { cwd: process.cwd() },
  systemPrompt: "You are a concise Telegram assistant. Reply in one or two sentences.",
});

const bot = new Bot(TELEGRAM_BOT_TOKEN);
const adapter = new TelegramAdapter({ bot });

async function collectReply(
  run: Awaited<ReturnType<Awaited<ReturnType<typeof factory.getOrCreate>>["send"]>>,
): Promise<string> {
  let reply = "";
  for await (const e of run.stream()) {
    if (e.type !== "assistant") continue;
    for (const part of e.message.content) {
      if (part.type === "text") reply += part.text;
    }
  }
  await run.wait();
  return reply;
}

const runner = new GatewayRunner({
  adapters: [adapter],
  handler: async (event, ctx) => {
    if (event.text.length === 0) return;
    const agentId = `${event.platform}-dm-${event.sender.id}`;
    const agent = await factory.getOrCreate(agentId);
    const run = await agent.send(event.text);
    const reply = await collectReply(run);
    if (reply.length > 0) await ctx.reply(reply);
  },
});

await runner.start();
console.log(`Bot started. Send a message in Telegram to your bot.`);

process.on("SIGINT", async () => {
  await runner.stop();
  process.exit(0);
});
