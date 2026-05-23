/**
 * Webhook helper tests (T2.2 + EC-1, EC-3, EC-4, EC-9).
 */

import * as crypto from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  __resetNonTextWarnings,
  normalizeInboundMessages,
  normalizeStatusReceipts,
  parseWebhookPayload,
  verifyWebhookSignature,
  verifyWebhookSubscription,
} from "../src/backend/cloud/webhook.js";

const APP_SECRET = "test-app-secret";

function signedHeader(body: string, secret = APP_SECRET): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

beforeEach(() => __resetNonTextWarnings());
afterEach(() => __resetNonTextWarnings());

describe("verifyWebhookSubscription (EC-1)", () => {
  it("test_verify_subscription_returns_challenge", () => {
    const r = verifyWebhookSubscription(
      {
        "hub.mode": "subscribe",
        "hub.verify_token": "my-token",
        "hub.challenge": "12345",
      },
      "my-token",
    );
    expect(r).toBe("12345");
  });

  it("test_verify_subscription_rejects_wrong_token", () => {
    const r = verifyWebhookSubscription(
      { "hub.mode": "subscribe", "hub.verify_token": "WRONG", "hub.challenge": "x" },
      "my-token",
    );
    expect(r).toBeNull();
  });

  it("test_verify_subscription_rejects_non_subscribe_mode", () => {
    const r = verifyWebhookSubscription(
      { "hub.mode": "unsubscribe", "hub.verify_token": "my-token", "hub.challenge": "x" },
      "my-token",
    );
    expect(r).toBeNull();
  });

  it("rejects missing challenge", () => {
    const r = verifyWebhookSubscription(
      { "hub.mode": "subscribe", "hub.verify_token": "my-token" },
      "my-token",
    );
    expect(r).toBeNull();
  });
});

describe("verifyWebhookSignature", () => {
  it("test_verify_signature_valid", () => {
    const body = '{"hello":"world"}';
    const ok = verifyWebhookSignature(body, signedHeader(body), APP_SECRET);
    expect(ok).toBe(true);
  });

  it("test_verify_signature_invalid", () => {
    const ok = verifyWebhookSignature('{"a":1}', signedHeader('{"b":2}'), APP_SECRET);
    expect(ok).toBe(false);
  });

  it("test_verify_signature_missing_prefix", () => {
    const ok = verifyWebhookSignature("body", "abc123", APP_SECRET);
    expect(ok).toBe(false);
  });

  it("test_verify_signature_length_mismatch_no_crash (EC-3)", () => {
    // Truncated header — would be < 32 bytes when hex-decoded.
    const ok = verifyWebhookSignature("body", "sha256=ab", APP_SECRET);
    expect(ok).toBe(false); // NOT throwing
  });

  it("test_verify_signature_undefined_header", () => {
    expect(verifyWebhookSignature("body", undefined, APP_SECRET)).toBe(false);
  });

  it("test_verify_signature_non_hex_chars", () => {
    expect(verifyWebhookSignature("body", "sha256=not-hex!!", APP_SECRET)).toBe(false);
  });

  it("accepts Buffer rawBody", () => {
    const buf = Buffer.from('{"a":1}', "utf8");
    const sig = signedHeader('{"a":1}');
    expect(verifyWebhookSignature(buf, sig, APP_SECRET)).toBe(true);
  });
});

describe("parseWebhookPayload + normalize (T2.2)", () => {
  function makeTextEnvelope(messages: unknown[]) {
    return {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "biz-1",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "5511", phone_number_id: "PNID" },
                contacts: [{ profile: { name: "Alice" }, wa_id: "5511888" }],
                messages,
              },
            },
          ],
        },
      ],
    };
  }

  it("test_normalize_extracts_text_messages", () => {
    const env = parseWebhookPayload(
      makeTextEnvelope([{ from: "5511888", id: "wamid.x", timestamp: "1700000000", type: "text", text: { body: "hi" } }]),
    );
    expect(env).not.toBeNull();
    const events = normalizeInboundMessages(env!);
    expect(events).toHaveLength(1);
    expect(events[0]!.text).toBe("hi");
    expect(events[0]!.contactName).toBe("Alice");
    expect(events[0]!.phoneNumberId).toBe("PNID");
  });

  it("test_normalize_skips_non_text_types (EC-4)", () => {
    const env = parseWebhookPayload(
      makeTextEnvelope([
        { from: "5511", id: "wamid.1", timestamp: "1700", type: "image", text: { body: "alt" } },
        { from: "5511", id: "wamid.2", timestamp: "1700", type: "audio" },
        { from: "5511", id: "wamid.3", timestamp: "1700", type: "video" },
        { from: "5511", id: "wamid.4", timestamp: "1700", type: "document" },
        { from: "5511", id: "wamid.5", timestamp: "1700", type: "location" },
      ]),
    );
    const events = normalizeInboundMessages(env!);
    expect(events).toHaveLength(0);
  });

  it("test_normalize_handles_empty_changes — no messages array yields empty []", () => {
    const env = parseWebhookPayload({
      object: "x",
      entry: [{ id: "e", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "", phone_number_id: "" } } }] }],
    });
    const events = normalizeInboundMessages(env!);
    expect(events).toEqual([]);
  });

  it("test_normalize_handles_empty_entries_array (EC-9) — Meta health ping", () => {
    const env = parseWebhookPayload({ object: "whatsapp_business_account", entry: [] });
    expect(env).not.toBeNull();
    expect(normalizeInboundMessages(env!)).toEqual([]);
    expect(normalizeStatusReceipts(env!)).toEqual([]);
  });

  it("test_normalize_extracts_status_receipts", () => {
    const env = parseWebhookPayload({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "e",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "5511", phone_number_id: "PNID" },
                statuses: [
                  { id: "wamid.s1", status: "delivered", timestamp: "1700000001", recipient_id: "5511888" },
                  { id: "wamid.s2", status: "read", timestamp: "1700000002", recipient_id: "5511888" },
                ],
              },
            },
          ],
        },
      ],
    });
    const receipts = normalizeStatusReceipts(env!);
    expect(receipts).toHaveLength(2);
    expect(receipts[0]!.status).toBe("delivered");
    expect(receipts[1]!.status).toBe("read");
  });

  it("returns null on unrecognized shape", () => {
    expect(parseWebhookPayload(null)).toBeNull();
    expect(parseWebhookPayload({ random: "junk" })).toBeNull();
    expect(parseWebhookPayload("string")).toBeNull();
  });
});
