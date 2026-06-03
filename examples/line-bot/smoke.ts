/**
 * LINE live smoke — env-gated push API call.
 *
 * LINE_LIVE_SMOKE=1 + LINE_TEST_USER_ID → pushMessage one real text.
 * Free tier covers ~500 push msgs/month; smoke costs nothing within that.
 *
 * Without LINE_LIVE_SMOKE=1, dry-mode only (constructor validation).
 */

import { LineAdapter } from "@theokit/gateway-line";

const live = process.env.LINE_LIVE_SMOKE === "1";

const required = ["LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN"];
for (const k of required) {
  if (process.env[k] === undefined || process.env[k] === "") {
    console.error(`Missing ${k} in .env`);
    process.exit(1);
  }
}

const adapter = new LineAdapter({
  channelSecret: process.env.LINE_CHANNEL_SECRET ?? "",
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
});

if (!live) {
  console.log("⚠ LINE_LIVE_SMOKE != 1 — dry mode (constructor only). Set =1 to push.");
  process.exit(0);
}

const userId = process.env.LINE_TEST_USER_ID;
if (userId === undefined || userId === "") {
  console.error("LINE_LIVE_SMOKE=1 requires LINE_TEST_USER_ID");
  process.exit(1);
}

const connected = await adapter.connect();
if (!connected) {
  console.error("✗ connect failed");
  process.exit(1);
}
console.log("✓ adapter connected");

const result = await adapter.sendMessage({
  channel: { id: userId, type: "dm" },
  text: `live-smoke ${new Date().toISOString()}`,
});
if (result.ok) {
  console.log(`✓ live send OK — messageId=${result.messageId ?? "n/a"}`);
} else {
  console.error(`✗ live send FAILED — code=${result.error?.code} message=${result.error?.message}`);
  await adapter.disconnect();
  process.exit(1);
}

await adapter.disconnect();
console.log("✓ smoke complete");
