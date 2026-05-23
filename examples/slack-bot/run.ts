/**
 * Slack bot demo (Adoption Roadmap #7; ADRs D267-D285).
 *
 * Connects via Socket Mode and echoes messages — DMs always; in channels
 * only when @mentioned (D285 default).
 *
 * Run:
 *   cp .env.example .env  &&  fill SLACK_BOT_TOKEN + SLACK_APP_TOKEN + OPENROUTER_API_KEY
 *   pnpm install
 *   pnpm run run
 *   # then DM your bot in Slack OR /invite + @mention in a channel
 */

import { Agent } from "@usetheo/sdk";
import { SlackAdapter } from "@usetheo/gateway-slack";

const botToken = process.env.SLACK_BOT_TOKEN;
const appToken = process.env.SLACK_APP_TOKEN;
const openrouter = process.env.OPENROUTER_API_KEY;

if (!botToken || !appToken) {
  console.error("SLACK_BOT_TOKEN and SLACK_APP_TOKEN required — see .env.example");
  process.exit(1);
}
if (!openrouter) {
  console.error("OPENROUTER_API_KEY required");
  process.exit(1);
}

const adapter = new SlackAdapter({
  botToken,
  appToken,
  // Default: requireMention=true. Public channel messages need to mention the bot.
});

// Model id with a "/" prefix routes through OpenRouter when only
// OPENROUTER_API_KEY is set. `openai/gpt-4o-mini` would require an explicit
// OpenAI key — use a Google model id since OpenRouter resells it cheaply.
const agent = await Agent.create({
  apiKey: openrouter,
  model: { id: process.env.SLACK_BOT_MODEL ?? "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd(), sandboxOptions: { enabled: false } as const },
  name: "slack-bot",
  systemPrompt: "You are a friendly Slack assistant. Reply concisely (1-2 sentences).",
});

adapter.onInbound(async (event) => {
  if (event.platform !== "slack") return;
  console.log(
    `[inbound] channel=${event.channel.type}/${event.channel.id} user=${event.sender.id} text="${event.text.slice(0, 80)}"`,
  );

  // Strip mention from text before sending to agent.
  const botUserId = adapter.getBotUserId();
  const cleanText = botUserId !== undefined
    ? event.text.replace(`<@${botUserId}>`, "").trim()
    : event.text;
  if (cleanText.length === 0) return; // empty after stripping mention

  try {
    const run = await agent.send(cleanText);
    const result = await run.wait();
    const errInfo = (result as { error?: { message?: string; name?: string } }).error;
    console.log(
      `[agent] status=${result.status} resultLen=${(result.result ?? "").length}` +
        (errInfo !== undefined ? ` error=${errInfo.name}: ${errInfo.message}` : ""),
    );
    const reply =
      result.status === "finished"
        ? (result.result ?? "(empty result)")
        : `(agent ${result.status}${errInfo !== undefined ? `: ${errInfo.message}` : ""})`;
    const sendResult = await adapter.sendMessage({
      channel: event.channel,
      text: reply,
      format: "plain",
    });
    if (!sendResult.ok) {
      console.error("[outbound] send failed:", sendResult.error);
    } else {
      console.log(`[outbound] sent ${reply.length} chars`);
    }
  } catch (err) {
    console.error("[handler]", err);
  }
});

const ok = await adapter.connect();
if (!ok) {
  console.error("Failed to connect — check tokens + Socket Mode enabled in Slack app");
  process.exit(1);
}
console.log(`Connected as ${adapter.getBotUserId()}. Send a DM or @mention in a channel.`);

// Graceful shutdown
const stop = async () => {
  console.log("Shutting down…");
  await adapter.disconnect();
  await agent.dispose();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
