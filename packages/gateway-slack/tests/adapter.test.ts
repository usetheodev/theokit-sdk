/**
 * SlackAdapter lifecycle + send + inbound tests with mocked @slack/bolt.
 *
 * Covers ADRs D275-D279 + EC-1 (orphan cleanup) + EC-2 (concurrent connect)
 * + EC-3 (mention guard) + send happy path + error mapping.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock @slack/bolt at module level ──────────────────────────────────────
const startMock = vi.fn(async () => undefined);
const stopMock = vi.fn(async () => undefined);
const authTestMock = vi.fn(async () => ({ user_id: "UBOT1234" }));
const postMessageMock = vi.fn(async () => ({ ts: "111.222" }));
const eventRegistrationMock = vi.fn();

vi.mock("@slack/bolt", () => {
  class MockApp {
    public client = {
      auth: { test: authTestMock },
      chat: { postMessage: postMessageMock },
    };
    constructor(_opts: unknown) {}
    event = eventRegistrationMock;
    start = startMock;
    stop = stopMock;
  }
  return { App: MockApp };
});

// Import AFTER vi.mock so the adapter resolves the mock.
import { SlackAdapter } from "../src/adapter.js";

beforeEach(() => {
  startMock.mockReset().mockImplementation(async () => undefined);
  stopMock.mockReset().mockImplementation(async () => undefined);
  authTestMock.mockReset().mockImplementation(async () => ({ user_id: "UBOT1234" }));
  postMessageMock.mockReset().mockImplementation(async () => ({ ts: "111.222" }));
  eventRegistrationMock.mockReset();
});

describe("SlackAdapter — connect/disconnect (D277/D278/D279)", () => {
  it("connect returns true on success and caches botUserId (D277)", async () => {
    const a = new SlackAdapter({ botToken: "xoxb-x", appToken: "xapp-x" });
    expect(await a.connect()).toBe(true);
    expect(a.getBotUserId()).toBe("UBOT1234");
    expect(startMock).toHaveBeenCalledOnce();
    expect(authTestMock).toHaveBeenCalledOnce();
    expect(eventRegistrationMock).toHaveBeenCalledWith("message", expect.any(Function));
  });

  it("connect is idempotent — second call returns true without restart", async () => {
    const a = new SlackAdapter({ botToken: "xoxb-x", appToken: "xapp-x" });
    expect(await a.connect()).toBe(true);
    expect(await a.connect()).toBe(true);
    expect(startMock).toHaveBeenCalledOnce(); // not called twice
  });

  it("D279: connect returns false on app.start failure (never throws)", async () => {
    startMock.mockImplementationOnce(async () => {
      throw new Error("network down");
    });
    const a = new SlackAdapter({ botToken: "xoxb-x", appToken: "xapp-x" });
    expect(await a.connect()).toBe(false);
    expect(a.getBotUserId()).toBeUndefined();
  });

  it("EC-1: auth.test throw after start → app.stop called to cleanup orphan", async () => {
    authTestMock.mockImplementationOnce(async () => {
      throw new Error("auth failed");
    });
    const a = new SlackAdapter({ botToken: "xoxb-x", appToken: "xapp-x" });
    expect(await a.connect()).toBe(false);
    expect(stopMock).toHaveBeenCalledOnce(); // orphan cleanup
    expect(a.getApp()).toBeUndefined();
  });

  it("EC-2: concurrent connect() calls share one in-flight start", async () => {
    let resolveStart: ((v: undefined) => void) | undefined;
    startMock.mockImplementationOnce(
      () => new Promise<undefined>((r) => { resolveStart = r; }),
    );
    const a = new SlackAdapter({ botToken: "xoxb-x", appToken: "xapp-x" });
    const p1 = a.connect();
    const p2 = a.connect();
    resolveStart?.(undefined);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(true);
    expect(r2).toBe(true);
    // start should be called exactly once, not twice
    expect(startMock).toHaveBeenCalledOnce();
  });

  it("D278: disconnect safe when never connected", async () => {
    const a = new SlackAdapter({ botToken: "xoxb-x", appToken: "xapp-x" });
    await expect(a.disconnect()).resolves.toBeUndefined();
    expect(stopMock).not.toHaveBeenCalled();
  });

  it("D278: disconnect calls app.stop + clears state", async () => {
    const a = new SlackAdapter({ botToken: "xoxb-x", appToken: "xapp-x" });
    await a.connect();
    await a.disconnect();
    expect(stopMock).toHaveBeenCalledOnce();
    expect(a.getApp()).toBeUndefined();
    expect(a.getBotUserId()).toBeUndefined();
  });

  it("disconnect tolerates app.stop throws (logs but does not propagate)", async () => {
    stopMock.mockImplementationOnce(async () => {
      throw new Error("stop error");
    });
    const a = new SlackAdapter({ botToken: "xoxb-x", appToken: "xapp-x" });
    await a.connect();
    await expect(a.disconnect()).resolves.toBeUndefined();
    expect(a.getApp()).toBeUndefined();
  });
});

describe("SlackAdapter — sendMessage", () => {
  it("returns not_connected when app undefined", async () => {
    const a = new SlackAdapter({ botToken: "xoxb-x", appToken: "xapp-x" });
    const r = await a.sendMessage({
      channel: { id: "C1", type: "group" },
      text: "hello",
    });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("not_connected");
  });

  it("returns empty_text when text is empty", async () => {
    const a = new SlackAdapter({ botToken: "xoxb-x", appToken: "xapp-x" });
    await a.connect();
    const r = await a.sendMessage({ channel: { id: "C1", type: "group" }, text: "" });
    expect(r.error?.code).toBe("empty_text");
  });

  it("calls chat.postMessage with channel + text", async () => {
    const a = new SlackAdapter({ botToken: "xoxb-x", appToken: "xapp-x" });
    await a.connect();
    const r = await a.sendMessage({
      channel: { id: "C1", type: "group" },
      text: "hello",
    });
    expect(r.ok).toBe(true);
    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "C1", text: "hello" }),
    );
  });

  it("D271: preserves thread_ts when topicId set", async () => {
    const a = new SlackAdapter({ botToken: "xoxb-x", appToken: "xapp-x" });
    await a.connect();
    await a.sendMessage({
      channel: { id: "C1", type: "thread", topicId: "100.5" },
      text: "reply",
    });
    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ thread_ts: "100.5" }),
    );
  });

  it("sets mrkdwn for markdown format (D281)", async () => {
    const a = new SlackAdapter({ botToken: "xoxb-x", appToken: "xapp-x" });
    await a.connect();
    await a.sendMessage({
      channel: { id: "C1", type: "group" },
      text: "*bold*",
      format: "markdown",
    });
    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ mrkdwn: true }),
    );
  });

  it("chunks long text (D272)", async () => {
    const a = new SlackAdapter({ botToken: "xoxb-x", appToken: "xapp-x" });
    await a.connect();
    const longText = "a".repeat(8500); // 3 chunks
    const r = await a.sendMessage({
      channel: { id: "C1", type: "group" },
      text: longText,
    });
    expect(r.ok).toBe(true);
    expect(postMessageMock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("returns ok with messageId from last chunk", async () => {
    const a = new SlackAdapter({ botToken: "xoxb-x", appToken: "xapp-x" });
    await a.connect();
    postMessageMock
      .mockImplementationOnce(async () => ({ ts: "1.1" }))
      .mockImplementationOnce(async () => ({ ts: "1.2" }));
    const r = await a.sendMessage({
      channel: { id: "C1", type: "group" },
      text: "a".repeat(5000),
    });
    expect(r.messageId).toBe("1.2");
  });

  it("maps Slack API errors to canonical SendResult (D273)", async () => {
    postMessageMock.mockImplementationOnce(async () => {
      // biome-ignore lint/suspicious/noExplicitAny: throw a SlackApiError-like object
      throw { data: { error: "channel_not_found" } } as any;
    });
    const a = new SlackAdapter({ botToken: "xoxb-x", appToken: "xapp-x" });
    await a.connect();
    const r = await a.sendMessage({ channel: { id: "C1", type: "group" }, text: "hi" });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("channel_not_found");
  });

  it("EC-6: send during in-flight connect returns not_connected before app set", async () => {
    // App is undefined until _doConnect resolves; mid-flight send before await
    // should report not_connected.
    let resolveStart: ((v: undefined) => void) | undefined;
    startMock.mockImplementationOnce(
      () => new Promise<undefined>((r) => { resolveStart = r; }),
    );
    const a = new SlackAdapter({ botToken: "xoxb-x", appToken: "xapp-x" });
    void a.connect();
    const r = await a.sendMessage({ channel: { id: "C1", type: "group" }, text: "hi" });
    expect(r.error?.code).toBe("not_connected");
    resolveStart?.(undefined);
  });
});

describe("SlackAdapter — onInbound (D276 / EC-H)", () => {
  it("invokes handler on inbound message", async () => {
    const a = new SlackAdapter({ botToken: "xoxb-x", appToken: "xapp-x" });
    await a.connect();
    const handler = vi.fn(async () => undefined);
    a.onInbound(handler);
    // Bolt calls our event handler with { body: ... } shape.
    const boltHandler = eventRegistrationMock.mock.calls[0]?.[1] as (args: { body: unknown }) => Promise<void>;
    await boltHandler({
      body: {
        team_id: "T",
        event: {
          type: "message",
          channel: "D1",
          ts: "100.1",
          user: "U1",
          text: "hello",
          channel_type: "im",
        },
      },
    });
    expect(handler).toHaveBeenCalledOnce();
    const event = handler.mock.calls[0]?.[0] as { platform: string; text: string };
    expect(event.platform).toBe("slack");
    expect(event.text).toBe("hello");
  });

  it("D276: second onInbound call replaces previous handler", async () => {
    const a = new SlackAdapter({ botToken: "xoxb-x", appToken: "xapp-x" });
    await a.connect();
    const h1 = vi.fn(async () => undefined);
    const h2 = vi.fn(async () => undefined);
    a.onInbound(h1);
    a.onInbound(h2);
    const boltHandler = eventRegistrationMock.mock.calls[0]?.[1] as (args: { body: unknown }) => Promise<void>;
    await boltHandler({
      body: {
        team_id: "T",
        event: {
          type: "message",
          channel: "D1",
          ts: "100.1",
          user: "U1",
          text: "hi",
          channel_type: "im",
        },
      },
    });
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledOnce();
  });

  it("unsubscribe function removes handler", async () => {
    const a = new SlackAdapter({ botToken: "xoxb-x", appToken: "xapp-x" });
    await a.connect();
    const handler = vi.fn(async () => undefined);
    const off = a.onInbound(handler);
    off();
    const boltHandler = eventRegistrationMock.mock.calls[0]?.[1] as (args: { body: unknown }) => Promise<void>;
    await boltHandler({
      body: {
        team_id: "T",
        event: {
          type: "message",
          channel: "D1",
          ts: "100.1",
          user: "U1",
          text: "hi",
          channel_type: "im",
        },
      },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("handler throw is logged but not propagated", async () => {
    const a = new SlackAdapter({ botToken: "xoxb-x", appToken: "xapp-x" });
    await a.connect();
    a.onInbound(async () => {
      throw new Error("handler kaboom");
    });
    const boltHandler = eventRegistrationMock.mock.calls[0]?.[1] as (args: { body: unknown }) => Promise<void>;
    await expect(
      boltHandler({
        body: {
          team_id: "T",
          event: {
            type: "message",
            channel: "D1",
            ts: "100.1",
            user: "U1",
            text: "hi",
            channel_type: "im",
          },
        },
      }),
    ).resolves.toBeUndefined();
  });

  it("D285: public-channel message without mention is silently dropped before handler", async () => {
    const a = new SlackAdapter({ botToken: "xoxb-x", appToken: "xapp-x" });
    await a.connect();
    const handler = vi.fn(async () => undefined);
    a.onInbound(handler);
    const boltHandler = eventRegistrationMock.mock.calls[0]?.[1] as (args: { body: unknown }) => Promise<void>;
    await boltHandler({
      body: {
        team_id: "T",
        event: {
          type: "message",
          channel: "C1",
          ts: "100.1",
          user: "U1",
          text: "not addressed to bot",
          channel_type: "channel",
        },
      },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("requireMention=false delivers all channel messages to handler", async () => {
    const a = new SlackAdapter({
      botToken: "xoxb-x",
      appToken: "xapp-x",
      requireMention: false,
    });
    await a.connect();
    const handler = vi.fn(async () => undefined);
    a.onInbound(handler);
    const boltHandler = eventRegistrationMock.mock.calls[0]?.[1] as (args: { body: unknown }) => Promise<void>;
    await boltHandler({
      body: {
        team_id: "T",
        event: {
          type: "message",
          channel: "C1",
          ts: "100.1",
          user: "U1",
          text: "free roam",
          channel_type: "channel",
        },
      },
    });
    expect(handler).toHaveBeenCalledOnce();
  });
});
