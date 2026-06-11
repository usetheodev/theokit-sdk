/**
 * Mattermost live smoke — env-gated.
 *
 * MATTERMOST_LIVE_SMOKE=1 + MM_BASE_URL + MM_BOT_TOKEN + MM_TEST_CHANNEL_ID
 * → posts one real message to the test channel.
 *
 * Without MATTERMOST_LIVE_SMOKE=1, the smoke runs in dry-mode:
 * adapter constructed + validation only, no real API call.
 */

import { MattermostAdapter } from "@theokit/gateway-mattermost";

const live = process.env.MATTERMOST_LIVE_SMOKE === "1";

const required = ["MM_BASE_URL", "MM_BOT_TOKEN"];
for (const k of required) {
  if (process.env[k] === undefined || process.env[k] === "") {
    console.error(`Missing ${k} in .env`);
    process.exit(1);
  }
}

const adapter = new MattermostAdapter({
  baseUrl: process.env.MM_BASE_URL ?? "",
  accessToken: process.env.MM_BOT_TOKEN ?? "",
});

if (!live) {
  console.log("⚠ MATTERMOST_LIVE_SMOKE != 1 — dry mode (constructor only). Set =1 to connect + post.");
  process.exit(0);
}

const channelId = process.env.MM_TEST_CHANNEL_ID;
if (channelId === undefined || channelId === "") {
  console.error("MATTERMOST_LIVE_SMOKE=1 requires MM_TEST_CHANNEL_ID");
  process.exit(1);
}

const connected = await adapter.connect();
if (!connected) {
  console.error("✗ connect failed");
  process.exit(1);
}
console.log("✓ adapter connected");

const result = await adapter.sendMessage({
  channel: { id: channelId, type: "group" },
  text: `live-smoke ${new Date().toISOString()}`,
});
if (result.ok) {
  console.log(`✓ live send OK — postId=${result.messageId}`);
} else {
  console.error(`✗ live send FAILED — code=${result.error?.code} message=${result.error?.message}`);
  await adapter.disconnect();
  process.exit(1);
}

await adapter.disconnect();
console.log("✓ smoke complete");
