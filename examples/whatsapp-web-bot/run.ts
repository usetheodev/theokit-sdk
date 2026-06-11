/**
 * WhatsApp bot example — UNOFFICIAL whatsapp-web.js subprocess bridge backend.
 *
 * Use this for personal accounts where Meta Business verification isn't an
 * option (dev, prototype, side projects). See README for risk disclosure
 * (account ban risk — WhatsApp doesn't officially support automation).
 *
 * No webhook server. The bridge subprocess maintains the WhatsApp Web
 * session in headless Chromium; you scan a QR code once and the session
 * persists in LocalAuth (`./wwebjs_auth/`).
 */

import {
  WhatsAppAdapter,
  WhatsAppWebBackend,
  type WhatsAppMessageEvent,
} from "@theokit/gateway-whatsapp";
import { Agent } from "@theokit/sdk";

const PROVIDER_KEY = required("OPENROUTER_API_KEY");
const SESSION_ID = process.env.WHATSAPP_SESSION_ID ?? "my-bot";
const BOT_PHONE = process.env.WHATSAPP_BOT_PHONE;

function required(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.length === 0) {
    console.error(`[whatsapp-web-bot] missing env var: ${name}`);
    process.exit(1);
  }
  return v;
}

const backend = new WhatsAppWebBackend({ sessionId: SESSION_ID });
const adapter = new WhatsAppAdapter(backend, {
  // Group mention filter only kicks in when botPhoneId is set.
  ...(BOT_PHONE !== undefined && BOT_PHONE.length > 0 ? { botPhoneId: BOT_PHONE } : {}),
  // Without BOT_PHONE, groups are dropped (silent default — see EC-7 / D309).
});

adapter.onInbound(async (event) => {
  if (event.platform !== "whatsapp") return;
  const wa = event as WhatsAppMessageEvent;
  console.log(`[whatsapp-web-bot] in from=${wa.sender.id} text=${wa.text.slice(0, 60)}`);

  const agent = await Agent.create({
    apiKey: PROVIDER_KEY,
    model: { id: "openai/gpt-4o-mini" },
    name: `whatsapp-web-${wa.channel.id}`,
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
  console.log(`[whatsapp-web-bot] status wamid=${receipt.wamid} → ${receipt.status}`);
});

console.log("[whatsapp-web-bot] starting — scan the QR code printed below on first run.");
console.log("[whatsapp-web-bot] (the bridge prints the QR to stderr — open WhatsApp on your phone → Linked devices)");

try {
  await adapter.connect();
  console.log("[whatsapp-web-bot] connected (session: " + SESSION_ID + "). Send a WhatsApp message to test.");
} catch (err) {
  console.error("[whatsapp-web-bot] connect failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}

process.on("SIGINT", async () => {
  console.log("\n[whatsapp-web-bot] shutting down");
  await adapter.disconnect();
  process.exit(0);
});
