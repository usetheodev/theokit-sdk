/**
 * `WhatsAppCloudClient` tests (T2.1).
 */

import { describe, expect, it, vi } from "vitest";

import { WhatsAppCloudClient } from "../src/backend/cloud/client.js";

function makeFetchOk(messageId = "wamid.abc"): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify({ messaging_product: "whatsapp", messages: [{ id: messageId }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as typeof fetch;
}

function makeFetchError(status: number, body: object): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  ) as typeof fetch;
}

describe("WhatsAppCloudClient — sendText", () => {
  it("test_cloud_client_send_text_url — correct graph.facebook.com URL", async () => {
    const fakeFetch = makeFetchOk();
    const client = new WhatsAppCloudClient({
      accessToken: "t",
      phoneNumberId: "PNID123",
      fetch: fakeFetch,
    });
    await client.sendText("5511", "hi", false);
    const url = (fakeFetch as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(url).toBe("https://graph.facebook.com/v18.0/PNID123/messages");
  });

  it("test_cloud_client_send_text_auth_header — Bearer token", async () => {
    const fakeFetch = makeFetchOk();
    const client = new WhatsAppCloudClient({
      accessToken: "SECRET",
      phoneNumberId: "PNID",
      fetch: fakeFetch,
    });
    await client.sendText("5511", "hi", false);
    const init = (fakeFetch as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer SECRET");
  });

  it("test_cloud_client_send_text_body_shape — individual recipient", async () => {
    const fakeFetch = makeFetchOk();
    const client = new WhatsAppCloudClient({
      accessToken: "t",
      phoneNumberId: "p",
      fetch: fakeFetch,
    });
    await client.sendText("5511999", "hello", false);
    const init = (fakeFetch as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.messaging_product).toBe("whatsapp");
    expect(body.recipient_type).toBe("individual");
    expect(body.to).toBe("5511999");
    expect(body.type).toBe("text");
    expect(body.text.body).toBe("hello");
  });

  it("test_cloud_send_text_to_group_omits_recipient_type (EC-10)", async () => {
    const fakeFetch = makeFetchOk();
    const client = new WhatsAppCloudClient({
      accessToken: "t",
      phoneNumberId: "p",
      fetch: fakeFetch,
    });
    await client.sendText("group@g.us", "hi all", true);
    const init = (fakeFetch as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.recipient_type).toBeUndefined();
    expect(body.to).toBe("group@g.us");
  });

  it("test_cloud_client_handles_4xx_to_invalid_request", async () => {
    const fakeFetch = makeFetchError(400, { error: { code: 100, message: "bad request" } });
    const client = new WhatsAppCloudClient({
      accessToken: "t",
      phoneNumberId: "p",
      fetch: fakeFetch,
    });
    const r = await client.sendText("x", "y", false);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("invalid_request");
  });

  it("test_cloud_client_handles_401_to_auth_failed", async () => {
    const fakeFetch = makeFetchError(401, { error: { code: 190, message: "Invalid OAuth" } });
    const client = new WhatsAppCloudClient({
      accessToken: "t",
      phoneNumberId: "p",
      fetch: fakeFetch,
    });
    const r = await client.sendText("x", "y", false);
    expect(r.error?.code).toBe("auth_failed");
  });

  it("test_cloud_client_handles_429_to_rate_limit", async () => {
    const fakeFetch = makeFetchError(429, { error: { code: 130, message: "throttled" } });
    const client = new WhatsAppCloudClient({
      accessToken: "t",
      phoneNumberId: "p",
      fetch: fakeFetch,
    });
    const r = await client.sendText("x", "y", false);
    expect(r.error?.code).toBe("rate_limit");
  });

  it("test_cloud_client_returns_wamid_on_success", async () => {
    const fakeFetch = makeFetchOk("wamid.zzz");
    const client = new WhatsAppCloudClient({
      accessToken: "t",
      phoneNumberId: "p",
      fetch: fakeFetch,
    });
    const r = await client.sendText("x", "y", false);
    expect(r.ok).toBe(true);
    expect(r.wamid).toBe("wamid.zzz");
  });

  it("test_cloud_client_network_error_to_server_error", async () => {
    const fakeFetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const client = new WhatsAppCloudClient({
      accessToken: "t",
      phoneNumberId: "p",
      fetch: fakeFetch,
    });
    const r = await client.sendText("x", "y", false);
    expect(r.error?.code).toBe("server_error");
  });
});
