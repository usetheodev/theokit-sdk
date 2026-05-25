/**
 * `WhatsAppCloudBackend` tests (T2.3).
 */

import * as crypto from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { WhatsAppCloudBackend } from "../src/backend/cloud/index.js";

const APP_SECRET = "test-secret";

function makeFetchOk(): typeof fetch {
  return vi.fn(
    async () =>
      new Response(
        JSON.stringify({ messaging_product: "whatsapp", messages: [{ id: "wamid.x" }] }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
  ) as typeof fetch;
}

function signedHeader(body: string): string {
  return "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(body).digest("hex");
}

function makeBackend(fetchImpl: typeof fetch = makeFetchOk()): WhatsAppCloudBackend {
  return new WhatsAppCloudBackend({
    accessToken: "t",
    phoneNumberId: "PNID",
    appSecret: APP_SECRET,
    fetch: fetchImpl,
  });
}

const TEXT_ENVELOPE = JSON.stringify({
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
            messages: [
              {
                from: "5511888",
                id: "wamid.in.1",
                timestamp: "1700",
                type: "text",
                text: { body: "hi" },
              },
            ],
          },
        },
      ],
    },
  ],
});

describe("WhatsAppCloudBackend", () => {
  it("test_cloud_backend_connect_noop_returns_true", async () => {
    const b = makeBackend();
    expect(await b.connect()).toBe(true);
  });

  it("test_cloud_backend_send_delegates_to_client", async () => {
    const fakeFetch = makeFetchOk();
    const b = makeBackend(fakeFetch);
    const r = await b.send({ to: "5511", isGroup: false, text: "hi" });
    expect(r.ok).toBe(true);
    expect(r.wamid).toBe("wamid.x");
    expect((fakeFetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("test_cloud_backend_handle_webhook_invalid_signature_no_dispatch", async () => {
    const b = makeBackend();
    const handler = vi.fn(async () => {});
    b.onInbound(handler);
    const ok = await b.handleWebhookPayload(TEXT_ENVELOPE, "sha256=DEADBEEF".padEnd(71, "0"));
    expect(ok).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it("test_cloud_backend_handle_webhook_valid_dispatches_to_inbound_handler", async () => {
    const b = makeBackend();
    const handler = vi.fn(async () => {});
    b.onInbound(handler);
    const ok = await b.handleWebhookPayload(TEXT_ENVELOPE, signedHeader(TEXT_ENVELOPE));
    expect(ok).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    const firstCall = handler.mock.calls[0];
    expect(firstCall).toBeDefined();
    expect((firstCall as unknown[])[0]).toMatchObject({ text: "hi" });
  });

  it("test_cloud_backend_handle_webhook_dispatches_status_receipts", async () => {
    const statusEnv = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "e",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "x", phone_number_id: "PNID" },
                statuses: [
                  { id: "wamid.s", status: "delivered", timestamp: "1700", recipient_id: "5511" },
                ],
              },
            },
          ],
        },
      ],
    });
    const b = makeBackend();
    const inboundH = vi.fn(async () => {});
    const statusH = vi.fn(async () => {});
    b.onInbound(inboundH);
    b.onStatusReceipt(statusH);
    const ok = await b.handleWebhookPayload(statusEnv, signedHeader(statusEnv));
    expect(ok).toBe(true);
    expect(inboundH).not.toHaveBeenCalled();
    expect(statusH).toHaveBeenCalledTimes(1);
    const firstCall = statusH.mock.calls[0];
    expect(firstCall).toBeDefined();
    expect((firstCall as unknown[])[0]).toMatchObject({ status: "delivered" });
  });
});
