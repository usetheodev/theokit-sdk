import { Agent } from "@usetheo/sdk";
import type { Context } from "grammy";
import { Bot } from "grammy";

/**
 * Restart-proof Telegram bot. One agent per chat. Survives `kill -9` thanks
 * to the persistent agent registry (ADR D17), persistent session messages
 * (ADR D18), per-agent send mutex (ADR D19), and corpus="sessions" recall
 * (ADR D20) shipped in @usetheo/sdk 1.0.0.
 *
 * Pattern: `Agent.getOrCreate(id, options)` (ADR D22) consolidates the
 * resume-or-create dance into a single call — no try/catch boilerplate, no
 * forgotten re-throw, no race condition on concurrent messages.
 */

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (TOKEN === undefined || TOKEN.length === 0) {
  console.error("Missing TELEGRAM_BOT_TOKEN. Copy .env.example to .env and set the token from @BotFather.");
  process.exit(1);
}

const bot = new Bot(TOKEN);

function resolveUserId(ctx: Context): string {
  // EC-11: in group chats, `ctx.chat.id` is the GROUP id — using it as the
  // memory userId would mix every member's facts. Fall back to `ctx.from.id`
  // outside 1:1 DMs so each member gets isolated memory.
  if (ctx.chat?.type === "private" && ctx.chat.id !== undefined) return String(ctx.chat.id);
  if (ctx.from?.id !== undefined) return String(ctx.from.id);
  return "anonymous";
}

function chatAgentId(ctx: Context): string {
  return `tg-${resolveUserId(ctx)}`;
}

async function getAgent(ctx: Context) {
  const agentId = chatAgentId(ctx);
  return Agent.getOrCreate(agentId, {
    apiKey: process.env.THEOKIT_API_KEY,
    model: { id: "google/gemini-2.0-flash-001" },
    local: { cwd: process.cwd() },
    memory: {
      enabled: true,
      namespace: "telegram-bot",
      scope: "user",
      userId: resolveUserId(ctx),
      activeRecall: { enabled: true, queryMode: "recent" },
    },
    systemPrompt:
      "You are a personal assistant on Telegram. Reply in 1-3 sentences. Be specific. Remember the user across restarts.",
  });
}

bot.command("start", async (ctx) => {
  await ctx.reply(
    "Theo here. I remember things across restarts.\n\n" +
      "Try:\n" +
      "  • Remember: my favorite framework is Vitest.\n" +
      "  • What's my favorite framework?\n" +
      "  • /recall vitest  (search past conversations)\n",
  );
});

bot.command("recall", async (ctx) => {
  const query = ctx.match.trim();
  if (query.length === 0) {
    await ctx.reply("Usage: /recall <query>");
    return;
  }
  const agent = await getAgent(ctx);
  try {
    const run = await agent.send(`Use memory_search with corpus="sessions" to find past conversations about: ${query}. Cite the runId of each hit.`);
    const result = await run.wait();
    if (result.status === "finished" && result.result !== undefined) {
      await ctx.reply(result.result);
    } else {
      await ctx.reply(`(run ${result.status})`);
    }
  } finally {
    await agent.dispose();
  }
});

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith("/")) return;
  const agent = await getAgent(ctx);
  try {
    const run = await agent.send(text);
    const result = await run.wait();
    if (result.status === "finished" && result.result !== undefined) {
      await ctx.reply(result.result);
    } else {
      await ctx.reply(`(run ${result.status})`);
    }
  } finally {
    await agent.dispose();
  }
});

bot.catch((err) => {
  console.error("Bot error:", err);
});

// Verify the token + log "Connected as @<username>" BEFORE bot.start() (which
// blocks on getUpdates forever). Makes the boot observable to humans and to
// CI sweeps that match the connected-marker line.
const me = await bot.api.getMe();
console.log(`Connected as @${me.username} (id=${me.id}). Send /start to your bot.`);
await bot.start();
