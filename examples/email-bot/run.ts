/**
 * Email bot example — built on `@usetheo/gateway-email`.
 *
 * Listens on IMAP IDLE (or polls when IDLE is unavailable), forwards inbound
 * messages to an SDK agent, and replies via SMTP with RFC 5322 threading
 * headers preserved (D337).
 *
 * Real-LLM validation: requires a provider key (default: OpenRouter).
 * Per `.claude/rules/real-llm-validation.md`, this example MUST be exercised
 * against a real LLM before declaring "validated".
 */

import {
  EmailAdapter,
  type EmailMessageEvent,
} from "@usetheo/gateway-email";
import { Agent } from "@usetheo/sdk";

function required(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.length === 0) {
    console.error(`[email-bot] missing env var: ${name}`);
    process.exit(1);
  }
  return v;
}

const ADDRESS = required("EMAIL_ADDRESS");
const PASSWORD = required("EMAIL_PASSWORD");
const IMAP_HOST = required("EMAIL_IMAP_HOST");
const SMTP_HOST = required("EMAIL_SMTP_HOST");
const IMAP_PORT = Number(process.env.EMAIL_IMAP_PORT ?? 993);
const SMTP_PORT = Number(process.env.EMAIL_SMTP_PORT ?? 587);
const FROM_NAME = process.env.EMAIL_FROM_NAME;
const POLL_INTERVAL_MS = process.env.EMAIL_POLL_INTERVAL_MS !== undefined
  ? Number(process.env.EMAIL_POLL_INTERVAL_MS)
  : undefined;
const ALLOWED_SENDERS =
  process.env.EMAIL_ALLOWED_SENDERS !== undefined
    && process.env.EMAIL_ALLOWED_SENDERS.length > 0
    ? process.env.EMAIL_ALLOWED_SENDERS.split(",").map((s) => s.trim())
    : undefined;
const PROVIDER_KEY = required("OPENROUTER_API_KEY");

const adapter = new EmailAdapter({
  address: ADDRESS,
  password: PASSWORD,
  imapHost: IMAP_HOST,
  imapPort: IMAP_PORT,
  smtpHost: SMTP_HOST,
  smtpPort: SMTP_PORT,
  ...(FROM_NAME !== undefined ? { fromName: FROM_NAME } : {}),
  ...(ALLOWED_SENDERS !== undefined ? { allowedSenders: ALLOWED_SENDERS } : {}),
  ...(POLL_INTERVAL_MS !== undefined ? { pollIntervalMs: POLL_INTERVAL_MS } : {}),
});

adapter.onInbound(async (event) => {
  if (event.platform !== "email") return;
  const em = event as EmailMessageEvent;
  console.log(
    `[email-bot] inbound from=${em.email.fromAddress} subject="${em.email.subject}" attachments=${em.email.attachmentCount}`,
  );
  const agent = await Agent.create({
    apiKey: PROVIDER_KEY,
    model: { id: "openai/gpt-4o-mini" },
    name: `email-${em.email.fromAddress}`,
    systemPrompt:
      "You are a concise email assistant. Reply in one short paragraph. Plain text only — no markdown headers, no bullet lists.",
  });
  try {
    const run = await agent.send(em.text);
    const result = await run.wait();
    const reply = result.result ?? "(no reply)";
    const send = await adapter.sendMessage({
      channel: em.channel,
      text: reply,
    });
    if (send.ok) {
      console.log(`[email-bot] replied messageId=${send.messageId ?? "(unknown)"}`);
    } else if (send.error !== undefined) {
      console.error(`[email-bot] send failed: ${send.error.code} — ${send.error.message}`);
    } else {
      console.error("[email-bot] send failed: (no error payload)");
    }
  } finally {
    await agent.dispose();
  }
});

const ok = await adapter.connect();
if (!ok) {
  console.error("[email-bot] FAILED to connect — check IMAP/SMTP credentials.");
  process.exit(1);
}
console.log(`[email-bot] connected as ${ADDRESS} (IMAP ${IMAP_HOST}:${IMAP_PORT}, SMTP ${SMTP_HOST}:${SMTP_PORT})`);
console.log("[email-bot] listening for inbound mail. Send an email to test.");

process.on("SIGINT", async () => {
  console.log("\n[email-bot] shutting down");
  await adapter.disconnect();
  process.exit(0);
});
