/**
 * Webhook helpers for Meta WhatsApp Business Cloud API (ADR D306, D312).
 *
 * Two boundaries:
 *   1. GET handshake — `verifyWebhookSubscription` (EC-1).
 *   2. POST callbacks — `verifyWebhookSignature` (EC-3 length guard) +
 *      `normalizeInboundMessages` (EC-4 text-only filter) +
 *      `normalizeStatusReceipts`.
 *
 * The user owns the HTTP route; we expose pure helpers they call from inside it.
 *
 * @public
 */

import * as crypto from "node:crypto";

import type { WhatsAppInboundEvent, WhatsAppStatusReceipt } from "../../backend-types.js";
import type { MetaIncomingMessage, MetaStatusUpdate, MetaWebhookEnvelope } from "./types.js";

const warnedNonTextTypes = new Set<string>();

/**
 * Verify Meta's GET `/webhook?hub.mode=subscribe&hub.challenge=...&hub.verify_token=...`
 * handshake (EC-1 absorbed).
 *
 * @returns `query["hub.challenge"]` when valid, `null` otherwise. The caller
 * echoes the challenge as `text/plain` on success.
 */
export function verifyWebhookSubscription(
  query: Record<string, string | undefined>,
  expectedVerifyToken: string,
): string | null {
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];
  if (mode !== "subscribe") return null;
  if (token === undefined || token !== expectedVerifyToken) return null;
  if (challenge === undefined || challenge.length === 0) return null;
  return challenge;
}

/**
 * Verify the `X-Hub-Signature-256` HMAC-SHA256 against the app secret (D312).
 *
 * EC-3 absorbed: length-guard BEFORE `timingSafeEqual` so a malformed header
 * (e.g. `sha256=ab`) returns `false` instead of throwing `RangeError` (DoS).
 *
 * @returns `true` iff the signature matches.
 */
export function verifyWebhookSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (signatureHeader === undefined) return false;
  if (!signatureHeader.startsWith("sha256=")) return false;
  const receivedHex = signatureHeader.slice(7);
  if (!/^[0-9a-f]+$/i.test(receivedHex)) return false;
  const received = Buffer.from(receivedHex, "hex");
  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  const expected = crypto.createHmac("sha256", appSecret).update(body).digest();
  // EC-3: length guard before timingSafeEqual.
  if (received.length !== expected.length) return false;
  return crypto.timingSafeEqual(received, expected);
}

/** Parse the raw JSON payload into a typed envelope. Returns `null` if shape is unrecognized. */
export function parseWebhookPayload(json: unknown): MetaWebhookEnvelope | null {
  if (json === null || typeof json !== "object") return null;
  const env = json as MetaWebhookEnvelope;
  if (env.object === undefined || !Array.isArray(env.entry)) return null;
  return env;
}

/**
 * Normalize inbound messages → `WhatsAppInboundEvent[]`.
 *
 * EC-4 absorbed: filters `message.type !== "text"` (v1 text-only). Non-text
 * types emit a one-shot stderr warn per type.
 */
export function normalizeInboundMessages(envelope: MetaWebhookEnvelope): WhatsAppInboundEvent[] {
  const out: WhatsAppInboundEvent[] = [];
  for (const entry of envelope.entry) {
    for (const change of entry.changes) {
      const value = change.value;
      if (value === undefined || value === null) continue;
      const messages = value.messages ?? [];
      const phoneNumberId = value.metadata?.phone_number_id;
      const contactByWaId = new Map<string, string | undefined>();
      for (const c of value.contacts ?? []) {
        contactByWaId.set(c.wa_id, c.profile?.name);
      }
      for (const msg of messages) {
        const normalized = normalizeOneMessage(msg, phoneNumberId, contactByWaId);
        if (normalized !== null) out.push(normalized);
      }
    }
  }
  return out;
}

function normalizeOneMessage(
  msg: MetaIncomingMessage,
  phoneNumberId: string | undefined,
  contactByWaId: Map<string, string | undefined>,
): WhatsAppInboundEvent | null {
  // EC-4: text-only in v1.
  if (msg.type !== "text") {
    if (!warnedNonTextTypes.has(msg.type)) {
      warnedNonTextTypes.add(msg.type);
      process.stderr.write(
        `[whatsapp] ignoring ${msg.type} message — v1 text-only (will be supported in v0.2+).\n`,
      );
    }
    return null;
  }
  const body = msg.text?.body ?? "";
  // Cloud API doesn't distinguish DM vs group at the message level — `from`
  // is the sender. We don't have a reliable group-detection signal in cloud
  // (groups need a different webhook subscription). v1 treats all inbound
  // as DM. If the user enables group webhooks, the `conversationType` heuristic
  // here is a future-extension point.
  return {
    wamid: msg.id,
    fromPhone: msg.from,
    phoneNumberId,
    contactName: contactByWaId.get(msg.from),
    conversationType: "dm",
    channelId: msg.from,
    text: body,
    receivedAt: Number(msg.timestamp) * 1000 || Date.now(),
    backend: "cloud",
    raw: msg,
  };
}

/** Normalize status updates → `WhatsAppStatusReceipt[]`. */
export function normalizeStatusReceipts(envelope: MetaWebhookEnvelope): WhatsAppStatusReceipt[] {
  const out: WhatsAppStatusReceipt[] = [];
  for (const entry of envelope.entry) {
    for (const change of entry.changes) {
      const statuses = change.value?.statuses ?? [];
      for (const s of statuses) {
        out.push(metaStatusToReceipt(s));
      }
    }
  }
  return out;
}

function metaStatusToReceipt(s: MetaStatusUpdate): WhatsAppStatusReceipt {
  return {
    wamid: s.id,
    status: s.status,
    recipient: s.recipient_id,
    timestamp: Number(s.timestamp) * 1000 || Date.now(),
  };
}

/** @internal — test seam to reset the one-shot warn de-dup. */
export function __resetNonTextWarnings(): void {
  warnedNonTextTypes.clear();
}
