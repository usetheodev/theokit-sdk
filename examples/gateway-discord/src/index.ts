/**
 * Minimal Discord bot using @usetheo/gateway + @usetheo/gateway-discord.
 *
 * Demonstrates two commands:
 *  - `!ping` — config-only response (proves transport works)
 *  - `!ask <q>` — real LLM round-trip through Agent.resume
 *
 * Run: pnpm tsx --env-file=.env src/index.ts
 */

import { Agent } from "@usetheo/sdk";
import { GatewayRunner, SessionRouter } from "@usetheo/gateway";
import { DiscordAdapter } from "@usetheo/gateway-discord";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const API_KEY = process.env.OPENROUTER_API_KEY ?? process.env.THEOKIT_API_KEY;
if (TOKEN === undefined || TOKEN.length === 0) {
  console.error("Missing DISCORD_BOT_TOKEN");
  process.exit(1);
}
if (API_KEY === undefined || API_KEY.length === 0) {
  console.error("Missing OPENROUTER_API_KEY / THEOKIT_API_KEY");
  process.exit(1);
}

const adapter = new DiscordAdapter({ token: TOKEN });
const router = new SessionRouter(); // default strategy: discord-dm-<id>, etc.

const runner = new GatewayRunner({
  adapters: [adapter],
  handler: async (event, ctx) => {
    if (event.platform !== "discord") return;
    const text = event.text.trim();

    // `!ping` — config-only, no LLM.
    if (text === "!ping") {
      await ctx.reply("pong");
      return;
    }

    // `!ask <q>` — real LLM round-trip via Agent.resume → send → reply.
    if (text.startsWith("!ask ")) {
      const question = text.slice("!ask ".length);
      const agentId = router.resolveAgentId(event);
      try {
        const agent = await Agent.create({
          apiKey: API_KEY,
          model: { id: "openai/gpt-4o-mini" },
          local: { cwd: process.cwd() },
          agentId,
        });
        try {
          const run = await agent.send(question);
          const result = await run.wait();
          await ctx.reply(result.result ?? "(empty reply)");
        } finally {
          await agent.dispose();
        }
      } catch (err) {
        await ctx.reply(`error: ${(err as Error).message.slice(0, 200)}`);
      }
      return;
    }
  },
});

await runner.start();
console.log("gateway-discord bot online — say !ping in any channel the bot can see");

const shutdown = async (): Promise<void> => {
  console.log("\nshutting down...");
  await runner.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
