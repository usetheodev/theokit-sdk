/**
 * Email live smoke (T6.2).
 *
 * Validates that the adapter can connect to the configured IMAP + SMTP
 * servers using the provided credentials. Does NOT send a real email
 * (would be visible to the account owner; out of scope for one-shot smoke).
 *
 * Skips silently when credentials are absent — per
 * `.claude/rules/real-llm-validation.md` we never claim "validated" without
 * a real backend hit.
 */

import { EmailAdapter } from "@usetheo/gateway-email";

const ADDRESS = process.env.EMAIL_ADDRESS;
const PASSWORD = process.env.EMAIL_PASSWORD;
const IMAP_HOST = process.env.EMAIL_IMAP_HOST;
const SMTP_HOST = process.env.EMAIL_SMTP_HOST;

if (
  ADDRESS === undefined || ADDRESS.length === 0
  || PASSWORD === undefined || PASSWORD.length === 0
  || IMAP_HOST === undefined || IMAP_HOST.length === 0
  || SMTP_HOST === undefined || SMTP_HOST.length === 0
) {
  console.log(
    "[email-smoke] skipped — set EMAIL_ADDRESS, EMAIL_PASSWORD, EMAIL_IMAP_HOST, EMAIL_SMTP_HOST to run the live smoke.",
  );
  process.exit(0);
}

const adapter = new EmailAdapter({
  address: ADDRESS,
  password: PASSWORD,
  imapHost: IMAP_HOST,
  imapPort: Number(process.env.EMAIL_IMAP_PORT ?? 993),
  smtpHost: SMTP_HOST,
  smtpPort: Number(process.env.EMAIL_SMTP_PORT ?? 587),
});

console.log(`[email-smoke] attempting connect to IMAP ${IMAP_HOST} + SMTP ${SMTP_HOST}...`);
const ok = await adapter.connect();
if (ok) {
  console.log("[email-smoke] PASS — IMAP IDLE registered + SMTP verified.");
  await adapter.disconnect();
  process.exit(0);
}
console.log("[email-smoke] FAIL — adapter could not connect. Check IMAP/SMTP host/port + App Password.");
process.exit(1);
