/**
 * SMS live smoke — env-gated outbound send via Twilio.
 *
 * Requires SMS_LIVE_SMOKE=1 to actually send (costs ~$0.0075 / SMS).
 * Without it, the smoke runs in dry-mode: build the adapter, connect,
 * disconnect — no real API call.
 */

import { SMSAdapter } from "@theokit/gateway-sms";

const live = process.env.SMS_LIVE_SMOKE === "1";

const requiredEnv = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"];
for (const k of requiredEnv) {
  if (process.env[k] === undefined || process.env[k] === "") {
    console.error(`Missing ${k} in .env`);
    process.exit(1);
  }
}

const adapter = new SMSAdapter({
  backend: "twilio",
  accountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
  authToken: process.env.TWILIO_AUTH_TOKEN ?? "",
  fromNumber: process.env.TWILIO_FROM ?? "",
  publicUrl: process.env.PUBLIC_URL ?? "http://localhost:3000",
});

await adapter.connect();
console.log("✓ adapter connected (twilio)");

if (live) {
  const to = process.env.TWILIO_TO;
  if (to === undefined || to === "") {
    console.error("SMS_LIVE_SMOKE=1 but TWILIO_TO is unset — cannot send.");
    process.exit(1);
  }
  const result = await adapter.sendMessage({
    channel: { id: to, type: "dm" },
    text: `live-smoke ${new Date().toISOString()}`,
  });
  if (result.ok) {
    console.log(`✓ live send OK — messageId=${result.messageId}`);
  } else {
    console.error(`✗ live send FAILED — code=${result.error?.code} message=${result.error?.message}`);
    await adapter.disconnect();
    process.exit(1);
  }
} else {
  console.log("⚠ SMS_LIVE_SMOKE != 1 — skipping live send. Set SMS_LIVE_SMOKE=1 to actually send.");
}

await adapter.disconnect();
console.log("✓ smoke complete");
