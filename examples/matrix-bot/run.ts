/**
 * Matrix bot example — Echo agent over matrix-js-sdk.
 *
 * Setup:
 * 1. Create a Matrix bot account (e.g. on matrix.org or your homeserver).
 * 2. Element web UI → Settings → Help & About → Advanced → Access Token.
 * 3. Copy into .env (MATRIX_ACCESS_TOKEN); also fill MATRIX_USER_ID.
 * 4. Invite the bot to a (unencrypted) room.
 * 5. `pnpm run`.
 */

import { Agent } from "@usetheo/sdk";
import { GatewayRunner } from "@usetheo/gateway";
import { MatrixAdapter } from "@usetheo/gateway-matrix";

const required = ["MATRIX_HOMESERVER_URL", "MATRIX_ACCESS_TOKEN", "MATRIX_USER_ID"];
for (const k of required) {
  if (process.env[k] === undefined || process.env[k] === "") {
    console.error(`Missing ${k} in .env`);
    process.exit(1);
  }
}

const apiKey =
  process.env.OPENROUTER_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY;
if (apiKey === undefined || apiKey === "") {
  console.error("Missing LLM provider key");
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
  name: "matrix-echo-bot",
  systemPrompt: "You are a Matrix bot. Reply concisely (2-3 sentences). Plain text only.",
});

const adapter = new MatrixAdapter({
  homeserverUrl: process.env.MATRIX_HOMESERVER_URL ?? "",
  accessToken: process.env.MATRIX_ACCESS_TOKEN ?? "",
  userId: process.env.MATRIX_USER_ID ?? "",
});

const runner = new GatewayRunner({
  adapters: [adapter],
  handler: async (event, ctx) => {
    if (event.platform !== "matrix") return;
    console.log(`[matrix-bot] in (${event.channel.type}) from=${event.sender.id}: ${event.text}`);
    const run = await agent.send(event.text);
    const result = await run.wait();
    const reply = (result.result ?? "(no reply)").slice(0, 4000);
    await ctx.reply(reply);
    console.log(`[matrix-bot] out → ${event.channel.id}: ${reply}`);
  },
});

const connected = await adapter.connect();
if (!connected) {
  console.error("✗ Matrix connect failed (check MATRIX_HOMESERVER_URL + MATRIX_ACCESS_TOKEN + MATRIX_USER_ID)");
  process.exit(1);
}
await runner.start();

console.log("✓ Matrix bot connected");
console.log(`  Homeserver: ${process.env.MATRIX_HOMESERVER_URL}`);
console.log(`  Bot user: ${process.env.MATRIX_USER_ID}`);
console.log("  Invite the bot to an UNENCRYPTED room to test. EC-3: live events only (≤60s).");

process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await runner.stop();
  await adapter.disconnect();
  await agent.dispose();
  process.exit(0);
});
