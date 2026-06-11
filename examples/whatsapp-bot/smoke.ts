/**
 * WhatsApp live smoke (T5.2).
 *
 * Sends ONE text message via the Cloud client to a pre-registered phone
 * number, asserts the `wamid` came back, and exits.
 *
 * Skips silently if env vars are absent — does NOT require a webhook server.
 *
 * Run via:  pnpm smoke
 *
 * Requires: WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN, WHATSAPP_TEST_PHONE
 *   (recipient phone MUST be registered in Meta Developer Console first —
 *    sandbox limit: 5 numbers).
 */

import { WhatsAppCloudBackend } from "@theokit/gateway-whatsapp";

const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const APP_SECRET = process.env.WHATSAPP_APP_SECRET ?? "smoke-no-webhook-needed";
const TEST_PHONE = process.env.WHATSAPP_TEST_PHONE;

if (
  PHONE_NUMBER_ID === undefined || PHONE_NUMBER_ID.length === 0
  || ACCESS_TOKEN === undefined || ACCESS_TOKEN.length === 0
  || TEST_PHONE === undefined || TEST_PHONE.length === 0
) {
  console.log(
    "[whatsapp-smoke] skipped — set WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN, " +
      "WHATSAPP_TEST_PHONE to run the live smoke.\n" +
      "  - Recipient MUST be pre-registered in Meta Developer Console (sandbox limit: 5).",
  );
  process.exit(0);
}

const backend = new WhatsAppCloudBackend({
  accessToken: ACCESS_TOKEN,
  phoneNumberId: PHONE_NUMBER_ID,
  appSecret: APP_SECRET,
});

const text = `[smoke ${new Date().toISOString()}] Hello from @theokit/gateway-whatsapp`;
console.log(`[whatsapp-smoke] sending to ${TEST_PHONE}: "${text}"`);

const r = await backend.send({ to: TEST_PHONE, isGroup: false, text });
if (r.ok && r.wamid !== undefined && r.wamid.startsWith("wamid.")) {
  console.log(`[whatsapp-smoke] PASS — wamid=${r.wamid}`);
  process.exit(0);
}

console.log(`[whatsapp-smoke] FAIL — ${JSON.stringify(r)}`);
console.log(
  "Common causes:\n" +
    "  - WHATSAPP_TEST_PHONE not pre-registered in Meta Console (recipient_phone_number_not_in_allowed_list)\n" +
    "  - Token expired or scope insufficient (auth_failed)\n" +
    "  - WhatsApp Business not yet provisioned for the phone number",
);
process.exit(1);
