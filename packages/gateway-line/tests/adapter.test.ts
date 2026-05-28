import type { MessageEvent } from "@usetheo/gateway";
import { describe, expect, it, vi } from "vitest";

import { LineAdapter } from "../src/adapter.js";
import type { LineSdkClient } from "../src/client.js";
import { ConfigurationError } from "../src/errors.js";
import type { LineWebhookEnvelope, LineWebhookEvent } from "../src/types.js";

function makeMockClient(): LineSdkClient & {
  replyCalls: Array<{ token: string; messages: unknown[] }>;
  pushCalls: Array<{ to: string; messages: unknown[] }>;
  failNextWith?: unknown;
} {
  const replyCalls: Array<{ token: string; messages: unknown[] }> = [];
  const pushCalls: Array<{ to: string; messages: unknown[] }> = [];
  return {
    replyCalls,
    pushCalls,
    failNextWith: undefined,
    async replyMessage(token, messages) {
      const self = this as { failNextWith?: unknown };
      if (self.failNextWith !== undefined) {
        const err = self.failNextWith;
        self.failNextWith = undefined;
        throw err;
      }
      replyCalls.push({ token, messages: [...messages] });
      return undefined;
    },
    async pushMessage(to, messages) {
      const self = this as { failNextWith?: unknown };
      if (self.failNextWith !== undefined) {
        const err = self.failNextWith;
        self.failNextWith = undefined;
        throw err;
      }
      pushCalls.push({ to, messages: [...messages] });
      return undefined;
    },
  } as LineSdkClient & {
    replyCalls: Array<{ token: string; messages: unknown[] }>;
    pushCalls: Array<{ to: string; messages: unknown[] }>;
    failNextWith?: unknown;
  };
}

function installMockClient(adapter: LineAdapter, client: LineSdkClient): void {
  (adapter as unknown as { client: LineSdkClient }).client = client;
  (adapter as unknown as { connected: boolean }).connected = true;
}

describe("LineAdapter constructor", () => {
  it("throws on empty channelSecret (D408)", () => {
    expect(
      () =>
        new LineAdapter({
          channelSecret: "",
          channelAccessToken: "tok",
        }),
    ).toThrow(ConfigurationError);
  });

  it("throws on empty channelAccessToken", () => {
    expect(
      () =>
        new LineAdapter({
          channelSecret: "secret",
          channelAccessToken: "",
        }),
    ).toThrow(ConfigurationError);
  });

  it("ConfigurationError carries actionable code", () => {
    try {
      new LineAdapter({ channelSecret: "", channelAccessToken: "tok" });
    } catch (err) {
      expect((err as ConfigurationError).code).toBe("channel_secret_required");
      return;
    }
    throw new Error("did not throw");
  });
});

describe("LineAdapter.sendMessage", () => {
  it("empty text returns SendResult{empty_text}", async () => {
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    installMockClient(adapter, makeMockClient());
    const result = await adapter.sendMessage({
      channel: { id: "U-alice", type: "dm" },
      text: "",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("empty_text");
  });

  it("not_connected when adapter wasn't connected", async () => {
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    const result = await adapter.sendMessage({
      channel: { id: "U-alice", type: "dm" },
      text: "hi",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("not_connected");
  });

  it("uses reply token first when available", async () => {
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    const client = makeMockClient();
    installMockClient(adapter, client);
    adapter._cacheReplyToken("U-alice", "rtok-1");
    const result = await adapter.sendMessage({
      channel: { id: "U-alice", type: "dm" },
      text: "hi",
    });
    expect(result.ok).toBe(true);
    expect(client.replyCalls).toHaveLength(1);
    expect(client.replyCalls[0]?.token).toBe("rtok-1");
    expect(client.pushCalls).toHaveLength(0);
  });

  it("falls back to push API when no reply token cached", async () => {
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    const client = makeMockClient();
    installMockClient(adapter, client);
    const result = await adapter.sendMessage({
      channel: { id: "U-alice", type: "dm" },
      text: "hi",
    });
    expect(result.ok).toBe(true);
    expect(client.replyCalls).toHaveLength(0);
    expect(client.pushCalls).toHaveLength(1);
  });

  it("reply token is one-shot — second send uses push (D407)", async () => {
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    const client = makeMockClient();
    installMockClient(adapter, client);
    adapter._cacheReplyToken("U-alice", "rtok-1");
    await adapter.sendMessage({ channel: { id: "U-alice", type: "dm" }, text: "1" });
    await adapter.sendMessage({ channel: { id: "U-alice", type: "dm" }, text: "2" });
    expect(client.replyCalls).toHaveLength(1);
    expect(client.pushCalls).toHaveLength(1);
  });

  it("multipart: first part uses reply, subsequent use push (D407 + D411)", async () => {
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    const client = makeMockClient();
    installMockClient(adapter, client);
    adapter._cacheReplyToken("U-alice", "rtok-1");
    await adapter.sendMessage({
      channel: { id: "U-alice", type: "dm" },
      text: "x".repeat(7_000), // 2 parts at 5000-cap
    });
    expect(client.replyCalls).toHaveLength(1);
    expect(client.pushCalls).toHaveLength(1);
  });

  it("maps 429 to rate_limit", async () => {
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    const client = makeMockClient();
    client.failNextWith = Object.assign(new Error("slow down"), { statusCode: 429 });
    installMockClient(adapter, client);
    const result = await adapter.sendMessage({
      channel: { id: "U-alice", type: "dm" },
      text: "hi",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("rate_limit");
  });

  it("maps 401 to permission_denied", async () => {
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    const client = makeMockClient();
    client.failNextWith = Object.assign(new Error("forbidden"), { statusCode: 401 });
    installMockClient(adapter, client);
    const result = await adapter.sendMessage({
      channel: { id: "U-alice", type: "dm" },
      text: "hi",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("permission_denied");
  });
});

describe("LineAdapter.dispatchWebhookBody (inbound)", () => {
  function makeEnv(events: LineWebhookEvent[]): LineWebhookEnvelope {
    return { events };
  }

  it("dispatches text DM to handler", async () => {
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    installMockClient(adapter, makeMockClient());
    const received: MessageEvent[] = [];
    adapter.onInbound(async (ev) => {
      received.push(ev);
    });
    await adapter.dispatchWebhookBody(
      makeEnv([
        {
          type: "message",
          source: { type: "user", userId: "U-alice" },
          replyToken: "rtok",
          message: { type: "text", id: "m-1", text: "hi" },
        },
      ]),
    );
    expect(received).toHaveLength(1);
    expect(received[0]?.platform).toBe("line");
    if (received[0]?.platform === "line") {
      expect(received[0].channel.type).toBe("dm");
    }
  });

  it("EC-4: ignores non-message events", async () => {
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    installMockClient(adapter, makeMockClient());
    const handler = vi.fn(async () => undefined);
    adapter.onInbound(handler);
    await adapter.dispatchWebhookBody(
      makeEnv([
        { type: "follow", source: { type: "user", userId: "U-a" } },
        { type: "unfollow", source: { type: "user", userId: "U-a" } },
        { type: "postback", source: { type: "user", userId: "U-a" } },
      ]),
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("EC-4: ignores non-text messages (image/sticker)", async () => {
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    installMockClient(adapter, makeMockClient());
    const handler = vi.fn(async () => undefined);
    adapter.onInbound(handler);
    await adapter.dispatchWebhookBody(
      makeEnv([
        {
          type: "message",
          source: { type: "user", userId: "U-a" },
          replyToken: "r",
          message: { type: "image", id: "im-1" },
        },
        {
          type: "message",
          source: { type: "user", userId: "U-a" },
          replyToken: "r",
          message: { type: "sticker", id: "st-1" },
        },
      ]),
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("caches reply token on receipt and uses it on next send", async () => {
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    const client = makeMockClient();
    installMockClient(adapter, client);
    adapter.onInbound(async () => undefined);
    await adapter.dispatchWebhookBody(
      makeEnv([
        {
          type: "message",
          source: { type: "user", userId: "U-alice" },
          replyToken: "rtok-inbound",
          message: { type: "text", id: "m-1", text: "hi" },
        },
      ]),
    );
    await adapter.sendMessage({
      channel: { id: "U-alice", type: "dm" },
      text: "hello back",
    });
    expect(client.replyCalls).toHaveLength(1);
    expect(client.replyCalls[0]?.token).toBe("rtok-inbound");
  });

  it("EC-H: onInbound replaces previous handler", async () => {
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    installMockClient(adapter, makeMockClient());
    const a = vi.fn(async () => undefined);
    const b = vi.fn(async () => undefined);
    adapter.onInbound(a);
    adapter.onInbound(b);
    await adapter.dispatchWebhookBody(
      makeEnv([
        {
          type: "message",
          source: { type: "user", userId: "U-alice" },
          replyToken: "r",
          message: { type: "text", id: "m-1", text: "hi" },
        },
      ]),
    );
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("handler throw isolated (no rethrow)", async () => {
    const adapter = new LineAdapter({ channelSecret: "s", channelAccessToken: "t" });
    installMockClient(adapter, makeMockClient());
    adapter.onInbound(async () => {
      throw new Error("boom");
    });
    await expect(
      adapter.dispatchWebhookBody(
        makeEnv([
          {
            type: "message",
            source: { type: "user", userId: "U-a" },
            replyToken: "r",
            message: { type: "text", id: "m-1", text: "hi" },
          },
        ]),
      ),
    ).resolves.toBeUndefined();
  });
});

describe("LineAdapter mention guard (D409)", () => {
  it("DM: always dispatches even when bot not mentioned", async () => {
    const adapter = new LineAdapter({
      channelSecret: "s",
      channelAccessToken: "t",
      botUserId: "U-bot",
      requireMention: true,
    });
    installMockClient(adapter, makeMockClient());
    const received: MessageEvent[] = [];
    adapter.onInbound(async (ev) => {
      received.push(ev);
    });
    await adapter.dispatchWebhookBody({
      events: [
        {
          type: "message",
          source: { type: "user", userId: "U-alice" },
          replyToken: "r",
          message: { type: "text", id: "m-1", text: "hi" },
        },
      ],
    });
    expect(received).toHaveLength(1);
  });

  it("Group + no mention + requireMention=true → ignore", async () => {
    const adapter = new LineAdapter({
      channelSecret: "s",
      channelAccessToken: "t",
      botUserId: "U-bot",
      requireMention: true,
    });
    installMockClient(adapter, makeMockClient());
    const received: MessageEvent[] = [];
    adapter.onInbound(async (ev) => {
      received.push(ev);
    });
    await adapter.dispatchWebhookBody({
      events: [
        {
          type: "message",
          source: { type: "group", groupId: "G-1", userId: "U-alice" },
          replyToken: "r",
          message: { type: "text", id: "m-1", text: "hi team" },
        },
      ],
    });
    expect(received).toHaveLength(0);
  });

  it("Group + bot in mentionees → dispatch", async () => {
    const adapter = new LineAdapter({
      channelSecret: "s",
      channelAccessToken: "t",
      botUserId: "U-bot",
      requireMention: true,
    });
    installMockClient(adapter, makeMockClient());
    const received: MessageEvent[] = [];
    adapter.onInbound(async (ev) => {
      received.push(ev);
    });
    await adapter.dispatchWebhookBody({
      events: [
        {
          type: "message",
          source: { type: "group", groupId: "G-1", userId: "U-alice" },
          replyToken: "r",
          message: {
            type: "text",
            id: "m-1",
            text: "@bot hi",
            mentionees: [{ index: 0, length: 4, userId: "U-bot" }],
          },
        },
      ],
    });
    expect(received).toHaveLength(1);
  });

  it("Group + requireMention=false → dispatch even without mention", async () => {
    const adapter = new LineAdapter({
      channelSecret: "s",
      channelAccessToken: "t",
      botUserId: "U-bot",
      requireMention: false,
    });
    installMockClient(adapter, makeMockClient());
    const received: MessageEvent[] = [];
    adapter.onInbound(async (ev) => {
      received.push(ev);
    });
    await adapter.dispatchWebhookBody({
      events: [
        {
          type: "message",
          source: { type: "group", groupId: "G-1", userId: "U-alice" },
          replyToken: "r",
          message: { type: "text", id: "m-1", text: "hi team" },
        },
      ],
    });
    expect(received).toHaveLength(1);
  });

  it("Group + botUserId unset → guard disabled (dispatches all)", async () => {
    const adapter = new LineAdapter({
      channelSecret: "s",
      channelAccessToken: "t",
      requireMention: true,
      // no botUserId
    });
    installMockClient(adapter, makeMockClient());
    const received: MessageEvent[] = [];
    adapter.onInbound(async (ev) => {
      received.push(ev);
    });
    await adapter.dispatchWebhookBody({
      events: [
        {
          type: "message",
          source: { type: "group", groupId: "G-1", userId: "U-alice" },
          replyToken: "r",
          message: { type: "text", id: "m-1", text: "hi team" },
        },
      ],
    });
    expect(received).toHaveLength(1);
  });
});
