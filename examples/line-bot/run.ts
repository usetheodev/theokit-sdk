/**
 * LINE bot example — Echo agent.
 *
 * Setup:
 * 1. developers.line.biz/console → create Provider + Messaging API channel.
 * 2. Copy "Channel secret" + issue long-lived "Channel access token" → .env.
 * 3. `pnpm install`, `ngrok http 3000`, paste https URL into the channel's webhook setting.
 * 4. Enable "Use webhook"; disable "Auto-reply messages".
 * 5. `pnpm run`.
 * 6. Add the bot as a friend (via Official Account Manager) and DM it.
 */

import { Agent } from "@usetheo/sdk";
import { GatewayRunner } from "@usetheo/gateway";
import { LineAdapter, createWebhookServer } from "@usetheo/gateway-line";

const requiredEnv = ["LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN", "PUBLIC_URL"];
for (const k of requiredEnv) {
  if (process.env[k] === undefined || process.env[k] === "") {
    console.error(`Missing ${k} in .env`);
    process.exit(1);
  }
}

const apiKey =
  process.env.OPENROUTER_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY;
if (apiKey === undefined || apiKey === "") {
  console.error("Missing OPENROUTER_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY in .env");
  process.exit(1);
}

const agent = await Agent.create({
  apiKey,
  model: { id: "openai/gpt-4o-mini" },
  providers:
    process.env.OPENROUTER_API_KEY !== undefined
      ? {
          routes: [{ capability: "chat", provider: "openrouter" }],
          fallback: ["openrouter"],
        }
      : undefined,
  local: { cwd: process.cwd(), sandboxOptions: { enabled: false } },
  name: "line-echo-bot",
  systemPrompt:
    "You are a LINE bot. Reply in 2-3 short sentences (max 200 chars). Plain text only.",
});

const adapter = new LineAdapter({
  channelSecret: process.env.LINE_CHANNEL_SECRET ?? "",
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
  ...(process.env.LINE_BOT_USER_ID !== undefined && process.env.LINE_BOT_USER_ID !== ""
    ? { botUserId: process.env.LINE_BOT_USER_ID }
    : {}),
});

const runner = new GatewayRunner({
  adapters: [adapter],
  handler: async (event, ctx) => {
    if (event.platform !== "line") return;
    console.log(`[line-bot] in (${event.channel.type}) from=${event.sender.id}: ${event.text}`);
    const run = await agent.send(event.text);
    const result = await run.wait();
    const reply = (result.result ?? "(no reply)").slice(0, 4000);
    await ctx.reply(reply);
    console.log(`[line-bot] out → ${event.channel.id}: ${reply}`);
  },
});

const connected = await adapter.connect();
if (!connected) {
  console.error("✗ LINE connect failed");
  process.exit(1);
}
await runner.start();
const server = await createWebhookServer({
  adapter,
  port: Number(process.env.PORT ?? 3000),
});
await server.start();

console.log(`✓ LINE bot listening on port ${process.env.PORT ?? 3000}`);
console.log(`  LINE webhook URL: ${process.env.PUBLIC_URL}/line`);
console.log("  DM the bot (add as friend first) or @-mention in a group.");

process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await server.stop();
  await runner.stop();
  await adapter.disconnect();
  await agent.dispose();
  process.exit(0);
});
