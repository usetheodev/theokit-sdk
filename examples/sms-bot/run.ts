/**
 * SMS bot example — Echo agent over Twilio SMS.
 *
 * Receives inbound SMS via a webhook, asks the agent to compose a
 * polite reply, and sends the response back. Demonstrates the full
 * adapter lifecycle and webhook server.
 *
 * Setup:
 * 1. Copy .env.example to .env and fill in your Twilio creds + OpenRouter key.
 * 2. Run `ngrok http 3000` and put the https URL into PUBLIC_URL.
 * 3. In Twilio Console, set your number's "A message comes in" webhook to:
 *    `${PUBLIC_URL}/sms/twilio`
 * 4. `pnpm run`
 * 5. Send an SMS to your Twilio number from your phone.
 */

import { Agent } from "@usetheo/sdk";
import { GatewayRunner } from "@usetheo/gateway";
import { createWebhookServer, SMSAdapter } from "@usetheo/gateway-sms";

const requiredEnv = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM", "PUBLIC_URL"];
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
  name: "sms-echo-bot",
  systemPrompt: "You are an SMS bot. Reply in <=160 chars. Plain text only.",
});

const adapter = new SMSAdapter({
  backend: "twilio",
  accountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
  authToken: process.env.TWILIO_AUTH_TOKEN ?? "",
  fromNumber: process.env.TWILIO_FROM ?? "",
  publicUrl: process.env.PUBLIC_URL ?? "",
});

const runner = new GatewayRunner({
  adapters: [adapter],
  handler: async (event, ctx) => {
    if (event.platform !== "sms") return;
    console.log(`[sms-bot] in from=${event.sender.id}: ${event.text}`);
    const run = await agent.send(event.text);
    const result = await run.wait();
    const reply = (result.result ?? "(no reply)").slice(0, 1500);
    await ctx.reply(reply);
    console.log(`[sms-bot] out → ${event.sender.id}: ${reply}`);
  },
});

await runner.start();
const server = await createWebhookServer({
  adapter,
  port: Number(process.env.PORT ?? 3000),
});
await server.start();

console.log(`✓ SMS bot listening on port ${process.env.PORT ?? 3000}`);
console.log(`  Twilio webhook URL: ${process.env.PUBLIC_URL}/sms/twilio`);
console.log("  Send an SMS to your Twilio number to test.");

process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await server.stop();
  await runner.stop();
  await agent.dispose();
  process.exit(0);
});
