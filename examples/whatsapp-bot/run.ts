/**
 * WhatsApp bot example — Meta WhatsApp Business Cloud API backend.
 *
 * Demonstrates the full receive → respond → status-receipt loop.
 *
 * Expose this server to the public internet (ngrok / Cloudflare Tunnel) so
 * Meta's webhook can reach it. See README.md for setup steps.
 */

import express from "express";

import {
  verifyWebhookSubscription,
  verifyWebhookSignature,
  WhatsAppAdapter,
  WhatsAppCloudBackend,
  type WhatsAppMessageEvent,
} from "@theokit/gateway-whatsapp";
import { Agent } from "@theokit/sdk";

const PHONE_NUMBER_ID = required("WHATSAPP_PHONE_NUMBER_ID");
const ACCESS_TOKEN = required("WHATSAPP_ACCESS_TOKEN");
const APP_SECRET = required("WHATSAPP_APP_SECRET");
const VERIFY_TOKEN = required("WHATSAPP_VERIFY_TOKEN");
const PROVIDER_KEY = required("OPENROUTER_API_KEY");
const PORT = Number(process.env.PORT ?? 3000);

function required(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.length === 0) {
    console.error(`[whatsapp-bot] missing env var: ${name}`);
    process.exit(1);
  }
  return v;
}

const backend = new WhatsAppCloudBackend({
  accessToken: ACCESS_TOKEN,
  phoneNumberId: PHONE_NUMBER_ID,
  appSecret: APP_SECRET,
});

const adapter = new WhatsAppAdapter(backend, {
  botPhoneId: PHONE_NUMBER_ID,
  // requireMention defaults to true for groups; Meta Cloud webhook only
  // delivers DMs by default, so this is just defensive.
});

adapter.onInbound(async (event) => {
  if (event.platform !== "whatsapp") return; // narrow
  const wa = event as WhatsAppMessageEvent;
  console.log(`[whatsapp-bot] inbound from=${wa.sender.id} text=${wa.text.slice(0, 60)}`);
  const agentId = `whatsapp-${wa.channel.id}`;
  const agent = await Agent.create({
    apiKey: PROVIDER_KEY,
    model: { id: "openai/gpt-4o-mini" },
    name: agentId,
    systemPrompt: "You are a concise WhatsApp assistant. Reply in one short paragraph.",
  });
  try {
    const run = await agent.send(wa.text);
    const result = await run.wait();
    await adapter.sendMessage({
      channel: wa.channel,
      text: result.result ?? "(no reply)",
    });
  } finally {
    await agent.dispose();
  }
});

adapter.onStatusReceipt(async (receipt) => {
  console.log(`[whatsapp-bot] status wamid=${receipt.wamid} → ${receipt.status}`);
});

const app = express();

// EC-2 absorbed: preserve rawBody bytes for HMAC verification.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as unknown as { rawBody: Buffer }).rawBody = buf;
    },
  }),
);

// EC-1 absorbed: Meta GET handshake.
app.get("/webhook", (req, res) => {
  const challenge = verifyWebhookSubscription(
    req.query as Record<string, string | undefined>,
    VERIFY_TOKEN,
  );
  if (challenge === null) {
    res.sendStatus(403);
    return;
  }
  res.type("text/plain").send(challenge);
});

// POST /webhook — Meta inbound callbacks.
app.post("/webhook", async (req, res) => {
  const rawBody = (req as unknown as { rawBody: Buffer }).rawBody;
  const sig = req.header("x-hub-signature-256");
  if (!verifyWebhookSignature(rawBody, sig, APP_SECRET)) {
    res.sendStatus(401);
    return;
  }
  const ok = await backend.handleWebhookPayload(rawBody, sig);
  res.sendStatus(ok ? 200 : 401);
});

app.get("/", (_req, res) => {
  res.type("text/plain").send("WhatsApp bot is running. Webhook URL: /webhook");
});

await backend.connect();
const server = app.listen(PORT, () => {
  console.log(`[whatsapp-bot] listening on http://localhost:${PORT}`);
  console.log(`[whatsapp-bot] webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`[whatsapp-bot] expose via ngrok: \`ngrok http ${PORT}\``);
});

process.on("SIGINT", async () => {
  console.log("\n[whatsapp-bot] shutting down");
  server.close();
  await adapter.disconnect();
  process.exit(0);
});
