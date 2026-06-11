/**
 * Microsoft Teams bot example — built on `@microsoft/teams.apps` v2.
 *
 * The Teams SDK auto-registers `POST /api/messages` on an Express app
 * passed via `httpServerAdapter` (D316/D326). We pass it through
 * `TeamsAdapter` and let the SDK handle wiring.
 *
 * Expose this server to the public internet (ngrok / Azure Bot Service
 * Messaging Endpoint). See README.md for the 8-step setup.
 */

import express from "express";
import { ExpressAdapter } from "@microsoft/teams.apps";

import {
  TeamsAdapter,
  type TeamsMessageEvent,
} from "@theokit/gateway-teams";
import { Agent } from "@theokit/sdk";

const CLIENT_ID = required("TEAMS_CLIENT_ID");
const CLIENT_SECRET = required("TEAMS_CLIENT_SECRET");
const TENANT_ID = required("TEAMS_TENANT_ID");
const BOT_DISPLAY_NAME = process.env.TEAMS_BOT_DISPLAY_NAME ?? "Theo";
const PROVIDER_KEY = required("OPENROUTER_API_KEY");
const PORT = Number(process.env.PORT ?? 3978);

function required(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.length === 0) {
    console.error(`[teams-bot] missing env var: ${name}`);
    process.exit(1);
  }
  return v;
}

const expressApp = express();
// EC-6: Teams SDK uses Authorization header for JWT — body is plain JSON.
// `express.json()` is sufficient; no rawBody preservation needed (unlike WhatsApp).
expressApp.use(express.json());

const httpServerAdapter = new ExpressAdapter(expressApp);

const adapter = new TeamsAdapter({
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  tenantId: TENANT_ID,
  botDisplayName: BOT_DISPLAY_NAME,
  httpServerAdapter,
});

adapter.onInbound(async (event) => {
  if (event.platform !== "teams") return;
  const tm = event as TeamsMessageEvent;
  console.log(
    `[teams-bot] inbound from=${tm.sender.id} convType=${tm.teams.conversationType} text=${tm.text.slice(0, 60)}`,
  );
  const agent = await Agent.create({
    apiKey: PROVIDER_KEY,
    model: { id: "openai/gpt-4o-mini" },
    name: `teams-${tm.channel.id}`,
    systemPrompt:
      "You are a concise Teams assistant. Reply in one short paragraph using Teams markdown when helpful.",
  });
  try {
    const run = await agent.send(tm.text);
    const result = await run.wait();
    await adapter.sendMessage({
      channel: tm.channel,
      text: result.result ?? "(no reply)",
    });
  } finally {
    await agent.dispose();
  }
});

await adapter.connect();
// Bind the port — the SDK already registered POST /api/messages on our
// Express app during adapter.connect() → app.initialize().
await httpServerAdapter.start(PORT);

console.log(`[teams-bot] listening on http://localhost:${PORT}`);
console.log(`[teams-bot] webhook URL: http://localhost:${PORT}/api/messages`);
console.log(`[teams-bot] expose via ngrok: \`ngrok http ${PORT}\``);

process.on("SIGINT", async () => {
  console.log("\n[teams-bot] shutting down");
  await adapter.disconnect();
  await httpServerAdapter.stop();
  process.exit(0);
});
