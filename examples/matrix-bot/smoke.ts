/**
 * Matrix live smoke — env-gated.
 *
 * MATRIX_LIVE_SMOKE=1 + MATRIX_TEST_ROOM → post one real message.
 * Without it, dry mode only (constructor validation).
 */

import { MatrixAdapter } from "@theokit/gateway-matrix";

const live = process.env.MATRIX_LIVE_SMOKE === "1";

const required = ["MATRIX_HOMESERVER_URL", "MATRIX_ACCESS_TOKEN", "MATRIX_USER_ID"];
for (const k of required) {
  if (process.env[k] === undefined || process.env[k] === "") {
    console.error(`Missing ${k} in .env`);
    process.exit(1);
  }
}

const adapter = new MatrixAdapter({
  homeserverUrl: process.env.MATRIX_HOMESERVER_URL ?? "",
  accessToken: process.env.MATRIX_ACCESS_TOKEN ?? "",
  userId: process.env.MATRIX_USER_ID ?? "",
});

if (!live) {
  console.log("⚠ MATRIX_LIVE_SMOKE != 1 — dry mode (constructor only). Set =1 to connect + post.");
  process.exit(0);
}

const room = process.env.MATRIX_TEST_ROOM;
if (room === undefined || room === "") {
  console.error("MATRIX_LIVE_SMOKE=1 requires MATRIX_TEST_ROOM");
  process.exit(1);
}

const connected = await adapter.connect();
if (!connected) {
  console.error("✗ connect failed");
  process.exit(1);
}
console.log("✓ adapter connected");

const result = await adapter.sendMessage({
  channel: { id: room, type: "group" },
  text: `live-smoke ${new Date().toISOString()}`,
});
if (result.ok) {
  console.log(`✓ live send OK — eventId=${result.messageId}`);
} else {
  console.error(`✗ live send FAILED — code=${result.error?.code} message=${result.error?.message}`);
  await adapter.disconnect();
  process.exit(1);
}

await adapter.disconnect();
console.log("✓ smoke complete");
