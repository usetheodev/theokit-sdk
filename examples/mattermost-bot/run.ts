/**
 * Mattermost bot example — Echo agent over WebSocket + REST.
 *
 * Setup:
 * 1. Create a bot account in System Console → Integrations → Bot Accounts.
 * 2. Generate a Personal Access Token (PAT).
 * 3. Add the bot to a channel.
 * 4. Copy .env.example to .env, fill MM_BASE_URL + MM_BOT_TOKEN + LLM key.
 * 5. `pnpm run`.
 * 6. @-mention the bot in a channel (or DM it).
 */

import { Agent } from "@theokit/sdk";
import { GatewayRunner } from "@theokit/gateway";
import { MattermostAdapter } from "@theokit/gateway-mattermost";

const requiredEnv = ["MM_BASE_URL", "MM_BOT_TOKEN"];
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
  name: "mattermost-echo-bot",
  systemPrompt: "You are a Mattermost bot. Reply concisely (2-3 sentences). Plain text only.",
});

const adapter = new MattermostAdapter({
  baseUrl: process.env.MM_BASE_URL ?? "",
  accessToken: process.env.MM_BOT_TOKEN ?? "",
});

const runner = new GatewayRunner({
  adapters: [adapter],
  handler: async (event, ctx) => {
    if (event.platform !== "mattermost") return;
    console.log(`[mm-bot] in (${event.channel.type}) from=${event.sender.id}: ${event.text}`);
    const run = await agent.send(event.text);
    const result = await run.wait();
    const reply = (result.result ?? "(no reply)").slice(0, 4000);
    await ctx.reply(reply);
    console.log(`[mm-bot] out → ${event.channel.id}: ${reply}`);
  },
});

const connected = await adapter.connect();
if (!connected) {
  console.error("✗ Mattermost connect failed (check MM_BASE_URL + MM_BOT_TOKEN)");
  process.exit(1);
}
await runner.start();

console.log("✓ Mattermost bot connected");
console.log(`  Server: ${process.env.MM_BASE_URL}`);
console.log("  DM the bot or @mention it in a channel to test.");

process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await runner.stop();
  await adapter.disconnect();
  await agent.dispose();
  process.exit(0);
});
