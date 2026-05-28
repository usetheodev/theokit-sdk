import type { MessageEvent, OutboundMessage } from "@usetheo/gateway";
import { describe, expect, it, vi } from "vitest";

import { MattermostAdapter, parsePostFromWS } from "../src/adapter.js";
import type { MattermostClientHandle, WSMessage } from "../src/client.js";
import { ConfigurationError } from "../src/errors.js";
import type { MattermostChannel, MattermostPost, MattermostUser } from "../src/types.js";

interface MockHandle extends MattermostClientHandle {
  posts: Array<{ channel_id: string; message: string; root_id?: string }>;
  emitted: Array<(msg: WSMessage) => void>;
  closed: number;
  failCreatePostWith?: { status_code: number; message: string };
}

function makeMockHandle(opts?: {
  botUserId?: string;
  botUsername?: string;
  channels?: Record<string, MattermostChannel>;
}): MockHandle {
  const posts: Array<{ channel_id: string; message: string; root_id?: string }> = [];
  const emitted: Array<(msg: WSMessage) => void> = [];
  const channels = opts?.channels ?? {};
  const handle = {
    botUserId: opts?.botUserId ?? "u-bot",
    botUsername: opts?.botUsername ?? "theo",
    channelCache: new Map<string, MattermostChannel>(),
    posts,
    emitted,
    closed: 0,
    failCreatePostWith: undefined as { status_code: number; message: string } | undefined,
    client: {
      setUrl: () => undefined,
      setToken: () => undefined,
      async getMe(): Promise<MattermostUser> {
        return { id: handle.botUserId, username: handle.botUsername };
      },
      async getChannel(channelId: string): Promise<MattermostChannel> {
        const ch = channels[channelId];
        if (ch === undefined) throw new Error("channel not found");
        return ch;
      },
      async createPost(post: {
        channel_id: string;
        message: string;
        root_id?: string;
      }): Promise<MattermostPost> {
        if (handle.failCreatePostWith !== undefined) {
          const e = handle.failCreatePostWith;
          throw Object.assign(new Error(e.message), { status_code: e.status_code });
        }
        posts.push(post);
        return {
          id: `post-${posts.length}`,
          user_id: handle.botUserId,
          channel_id: post.channel_id,
          root_id: post.root_id ?? "",
          message: post.message,
          create_at: Date.now(),
        };
      },
    },
    ws: {
      initialize: () => undefined,
      addMessageListener: (l: (msg: WSMessage) => void) => {
        emitted.push(l);
      },
      removeMessageListener: (l: (msg: WSMessage) => void) => {
        const idx = emitted.indexOf(l);
        if (idx >= 0) emitted.splice(idx, 1);
      },
      close: () => {
        handle.closed += 1;
      },
    },
  } as unknown as MockHandle;
  return handle;
}

function installMockHandle(adapter: MattermostAdapter, handle: MockHandle): void {
  // Bypass real connect — inject the mock + flip connected flag + attach listener.
  (adapter as unknown as { handle: MockHandle }).handle = handle;
  (adapter as unknown as { connected: boolean }).connected = true;
  // Subclass private — replay the same listener installation the real `connect` would do.
  (adapter as unknown as { attachWsListener: () => void }).attachWsListener();
}

describe("MattermostAdapter constructor", () => {
  it("throws on empty baseUrl", () => {
    expect(() => new MattermostAdapter({ baseUrl: "", accessToken: "tok" })).toThrow(
      ConfigurationError,
    );
  });

  it("throws on empty accessToken (D401)", () => {
    expect(
      () => new MattermostAdapter({ baseUrl: "https://mm.acme.com", accessToken: "" }),
    ).toThrow(ConfigurationError);
  });

  it("ConfigurationError carries actionable code", () => {
    try {
      new MattermostAdapter({ baseUrl: "https://x.com", accessToken: "" });
    } catch (err) {
      expect((err as ConfigurationError).code).toBe("access_token_required");
      return;
    }
    throw new Error("did not throw");
  });
});

describe("MattermostAdapter.sendMessage", () => {
  it("rejects empty text", async () => {
    const adapter = new MattermostAdapter({ baseUrl: "https://x.com", accessToken: "tok" });
    installMockHandle(adapter, makeMockHandle());
    const result = await adapter.sendMessage({
      channel: { id: "c-1", type: "dm" },
      text: "",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("empty_text");
  });

  it("returns not_connected when adapter never connected", async () => {
    const adapter = new MattermostAdapter({ baseUrl: "https://x.com", accessToken: "tok" });
    const result = await adapter.sendMessage({
      channel: { id: "c-1", type: "dm" },
      text: "hi",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("not_connected");
  });

  it("DM send does NOT set root_id", async () => {
    const adapter = new MattermostAdapter({ baseUrl: "https://x.com", accessToken: "tok" });
    const handle = makeMockHandle();
    installMockHandle(adapter, handle);
    await adapter.sendMessage({
      channel: { id: "c-1", type: "dm" },
      text: "hi",
    } satisfies OutboundMessage);
    expect(handle.posts[0]).toEqual({ channel_id: "c-1", message: "hi" });
  });

  it("Thread send sets root_id from topicId (D399)", async () => {
    const adapter = new MattermostAdapter({ baseUrl: "https://x.com", accessToken: "tok" });
    const handle = makeMockHandle();
    installMockHandle(adapter, handle);
    await adapter.sendMessage({
      channel: { id: "c-1", type: "thread", topicId: "root-7" },
      text: "reply",
    } satisfies OutboundMessage);
    expect(handle.posts[0]).toEqual({ channel_id: "c-1", message: "reply", root_id: "root-7" });
  });

  it("returns permission_denied on 403 (EC-9)", async () => {
    const adapter = new MattermostAdapter({ baseUrl: "https://x.com", accessToken: "tok" });
    const handle = makeMockHandle();
    handle.failCreatePostWith = { status_code: 403, message: "no permission" };
    installMockHandle(adapter, handle);
    const result = await adapter.sendMessage({
      channel: { id: "c-priv", type: "group" },
      text: "hi",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("permission_denied");
  });

  it("returns rate_limit on 429", async () => {
    const adapter = new MattermostAdapter({ baseUrl: "https://x.com", accessToken: "tok" });
    const handle = makeMockHandle();
    handle.failCreatePostWith = { status_code: 429, message: "slow down" };
    installMockHandle(adapter, handle);
    const result = await adapter.sendMessage({
      channel: { id: "c-1", type: "dm" },
      text: "hi",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("rate_limit");
  });
});

describe("MattermostAdapter inbound dispatch", () => {
  function makeWSPostedMessage(post: Partial<MattermostPost>, sender_name = "@alice"): WSMessage {
    return {
      event: "posted",
      data: {
        post: JSON.stringify({
          id: "p1",
          user_id: "u-alice",
          channel_id: "c-dm",
          root_id: "",
          message: "hi @theo",
          create_at: 1700000000,
          ...post,
        } satisfies MattermostPost),
        sender_name,
      },
    };
  }

  it("dispatches inbound DM event to handler", async () => {
    const adapter = new MattermostAdapter({ baseUrl: "https://x.com", accessToken: "tok" });
    const handle = makeMockHandle({
      channels: { "c-dm": { id: "c-dm", team_id: "t-1", type: "D" } },
    });
    installMockHandle(adapter, handle);
    const received: MessageEvent[] = [];
    adapter.onInbound(async (ev) => {
      received.push(ev);
    });
    // Drive the WS listener directly.
    const listener = handle.emitted[0];
    expect(listener).toBeDefined();
    listener?.(makeWSPostedMessage({ channel_id: "c-dm" }));
    await new Promise((r) => setTimeout(r, 5));
    expect(received).toHaveLength(1);
    expect(received[0]?.platform).toBe("mattermost");
    if (received[0]?.platform === "mattermost") {
      expect(received[0].channel.type).toBe("dm");
    }
  });

  it("EC-2: ignores @theory_dept in a channel for a 'theo' bot", async () => {
    const adapter = new MattermostAdapter({ baseUrl: "https://x.com", accessToken: "tok" });
    const handle = makeMockHandle({
      channels: { "c-open": { id: "c-open", team_id: "t-1", type: "O" } },
    });
    installMockHandle(adapter, handle);
    const received: MessageEvent[] = [];
    adapter.onInbound(async (ev) => {
      received.push(ev);
    });
    const listener = handle.emitted[0];
    listener?.(
      makeWSPostedMessage({
        channel_id: "c-open",
        message: "@theory_dept please review",
      }),
    );
    await new Promise((r) => setTimeout(r, 5));
    expect(received).toHaveLength(0);
  });

  it("respects metadata.mentions priority (D403)", async () => {
    const adapter = new MattermostAdapter({ baseUrl: "https://x.com", accessToken: "tok" });
    const handle = makeMockHandle({
      channels: { "c-open": { id: "c-open", team_id: "t-1", type: "O" } },
    });
    installMockHandle(adapter, handle);
    const received: MessageEvent[] = [];
    adapter.onInbound(async (ev) => {
      received.push(ev);
    });
    const listener = handle.emitted[0];
    listener?.(
      makeWSPostedMessage({
        channel_id: "c-open",
        message: "fyi everyone please review",
        metadata: { mentions: ["u-bot"] },
      }),
    );
    await new Promise((r) => setTimeout(r, 5));
    expect(received).toHaveLength(1);
  });

  it("ignores bot's own posts (loop guard)", async () => {
    const adapter = new MattermostAdapter({ baseUrl: "https://x.com", accessToken: "tok" });
    const handle = makeMockHandle({
      channels: { "c-dm": { id: "c-dm", team_id: "t-1", type: "D" } },
    });
    installMockHandle(adapter, handle);
    const received: MessageEvent[] = [];
    adapter.onInbound(async (ev) => {
      received.push(ev);
    });
    const listener = handle.emitted[0];
    listener?.(makeWSPostedMessage({ user_id: "u-bot", channel_id: "c-dm" }));
    await new Promise((r) => setTimeout(r, 5));
    expect(received).toHaveLength(0);
  });

  it("EC-H: onInbound replaces previous handler", async () => {
    const adapter = new MattermostAdapter({ baseUrl: "https://x.com", accessToken: "tok" });
    const handle = makeMockHandle({
      channels: { "c-dm": { id: "c-dm", team_id: "t-1", type: "D" } },
    });
    installMockHandle(adapter, handle);
    const a = vi.fn(async () => undefined);
    const b = vi.fn(async () => undefined);
    adapter.onInbound(a);
    adapter.onInbound(b);
    const listener = handle.emitted[0];
    listener?.(makeWSPostedMessage({ channel_id: "c-dm" }));
    await new Promise((r) => setTimeout(r, 5));
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("handler throw is isolated (no rethrow)", async () => {
    const adapter = new MattermostAdapter({ baseUrl: "https://x.com", accessToken: "tok" });
    const handle = makeMockHandle({
      channels: { "c-dm": { id: "c-dm", team_id: "t-1", type: "D" } },
    });
    installMockHandle(adapter, handle);
    adapter.onInbound(async () => {
      throw new Error("handler boom");
    });
    const listener = handle.emitted[0];
    expect(() => listener?.(makeWSPostedMessage({ channel_id: "c-dm" }))).not.toThrow();
    await new Promise((r) => setTimeout(r, 5));
  });

  it("requireMention=false allows respond to channel post without mention", async () => {
    const adapter = new MattermostAdapter({
      baseUrl: "https://x.com",
      accessToken: "tok",
      requireMention: false,
    });
    const handle = makeMockHandle({
      channels: { "c-open": { id: "c-open", team_id: "t-1", type: "O" } },
    });
    installMockHandle(adapter, handle);
    const received: MessageEvent[] = [];
    adapter.onInbound(async (ev) => {
      received.push(ev);
    });
    const listener = handle.emitted[0];
    listener?.(
      makeWSPostedMessage({
        channel_id: "c-open",
        message: "just a thought (no mention)",
      }),
    );
    await new Promise((r) => setTimeout(r, 5));
    expect(received).toHaveLength(1);
  });
});

describe("parsePostFromWS", () => {
  it("returns undefined when data.post is missing", () => {
    expect(parsePostFromWS({ event: "posted", data: {} })).toBeUndefined();
  });

  it("returns undefined when data.post is malformed JSON", () => {
    expect(parsePostFromWS({ event: "posted", data: { post: "{not-json" } })).toBeUndefined();
  });

  it("returns undefined when required fields missing", () => {
    expect(
      parsePostFromWS({
        event: "posted",
        data: { post: JSON.stringify({ id: "p1" }) },
      }),
    ).toBeUndefined();
  });

  it("parses well-formed post", () => {
    const post = parsePostFromWS({
      event: "posted",
      data: {
        post: JSON.stringify({
          id: "p1",
          user_id: "u",
          channel_id: "c",
          root_id: "",
          message: "hi",
          create_at: 0,
        }),
      },
    });
    expect(post?.id).toBe("p1");
  });
});

describe("MattermostAdapter lifecycle", () => {
  it("disconnect() is idempotent + closes WS once", async () => {
    const adapter = new MattermostAdapter({ baseUrl: "https://x.com", accessToken: "tok" });
    const handle = makeMockHandle();
    installMockHandle(adapter, handle);
    await adapter.disconnect();
    await adapter.disconnect();
    expect(handle.closed).toBe(1);
  });

  it("getClient returns the underlying handle (escape hatch)", () => {
    const adapter = new MattermostAdapter({ baseUrl: "https://x.com", accessToken: "tok" });
    const handle = makeMockHandle();
    installMockHandle(adapter, handle);
    expect(adapter.getClient()).toBe(handle);
  });
});
