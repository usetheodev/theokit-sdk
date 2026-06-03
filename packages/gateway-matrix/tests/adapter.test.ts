import type { MessageEvent } from "@theokit/gateway";
import { describe, expect, it, vi } from "vitest";

import { MatrixAdapter } from "../src/adapter.js";
import type { MatrixSdkClient } from "../src/client.js";
import { ConfigurationError } from "../src/errors.js";
import type { MatrixEventLike, MatrixRoomLike } from "../src/types.js";

function makeMockClient(): MatrixSdkClient & {
  sent: Array<{ roomId: string; text: string }>;
  listeners: Array<(e: MatrixEventLike, r: MatrixRoomLike) => void>;
  failNextSendWith?: { httpStatus?: number; errcode?: string; message?: string };
  encryptedRooms: Set<string>;
  resolved: Record<string, string>;
} {
  const sent: Array<{ roomId: string; text: string }> = [];
  const listeners: Array<(e: MatrixEventLike, r: MatrixRoomLike) => void> = [];
  const encryptedRooms = new Set<string>();
  const resolved: Record<string, string> = {};
  const c = {
    sent,
    listeners,
    encryptedRooms,
    resolved,
    failNextSendWith: undefined as
      | { httpStatus?: number; errcode?: string; message?: string }
      | undefined,
    on(_evt: "Room.timeline", l: (e: MatrixEventLike, r: MatrixRoomLike) => void) {
      listeners.push(l);
    },
    off(_evt: "Room.timeline", l: (e: MatrixEventLike, r: MatrixRoomLike) => void) {
      const idx = listeners.indexOf(l);
      if (idx >= 0) listeners.splice(idx, 1);
    },
    async startClient() {
      return undefined;
    },
    stopClient() {
      // noop in tests
    },
    async sendTextMessage(roomId: string, text: string) {
      const self = this as unknown as {
        failNextSendWith?: { httpStatus?: number; message?: string };
      };
      if (self.failNextSendWith !== undefined) {
        const e = self.failNextSendWith;
        self.failNextSendWith = undefined;
        throw Object.assign(new Error(e.message ?? "fail"), e);
      }
      sent.push({ roomId, text });
      return { event_id: `$evt-${sent.length}:server` };
    },
    async getRoomIdForAlias(alias: string) {
      const room_id = resolved[alias] ?? `!resolved-${alias}:server`;
      return { room_id };
    },
    getRoom() {
      return null;
    },
    isRoomEncrypted(roomId: string) {
      return encryptedRooms.has(roomId);
    },
    getUserId() {
      return "@bot:matrix.org";
    },
  };
  return c as unknown as MatrixSdkClient & typeof c;
}

function makeEvent(
  opts?: Partial<{
    id: string;
    sender: string;
    type: string;
    body: string;
    ts: number;
  }>,
): MatrixEventLike {
  return {
    getId: () => opts?.id ?? "evt-1",
    getSender: () => opts?.sender ?? "@alice:matrix.org",
    getRoomId: () => "!r:server",
    getType: () => opts?.type ?? "m.room.message",
    getContent: () => ({ body: opts?.body ?? "hi", msgtype: "m.text" }),
    getTs: () => opts?.ts ?? Date.now(),
  };
}

function makeRoom(memberCount = 2, roomId = "!r:server"): MatrixRoomLike {
  return { roomId, getJoinedMemberCount: () => memberCount };
}

describe("MatrixAdapter constructor", () => {
  it("throws on empty homeserverUrl", () => {
    expect(
      () =>
        new MatrixAdapter({
          homeserverUrl: "",
          accessToken: "t",
          userId: "@bot:matrix.org",
        }),
    ).toThrow(ConfigurationError);
  });

  it("throws on empty accessToken", () => {
    expect(
      () =>
        new MatrixAdapter({
          homeserverUrl: "https://matrix.org",
          accessToken: "",
          userId: "@bot:matrix.org",
        }),
    ).toThrow(ConfigurationError);
  });

  it("throws on userId without @ prefix", () => {
    expect(
      () =>
        new MatrixAdapter({
          homeserverUrl: "https://matrix.org",
          accessToken: "t",
          userId: "bot:matrix.org",
        }),
    ).toThrow(ConfigurationError);
  });

  it("ConfigurationError carries actionable code", () => {
    try {
      new MatrixAdapter({ homeserverUrl: "", accessToken: "t", userId: "@bot:m" });
    } catch (err) {
      expect((err as ConfigurationError).code).toBe("homeserver_url_required");
      return;
    }
    throw new Error("did not throw");
  });
});

describe("MatrixAdapter.sendMessage", () => {
  it("rejects empty text", async () => {
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: "@bot:matrix.org",
    });
    adapter._installClient(makeMockClient());
    const result = await adapter.sendMessage({
      channel: { id: "!r:server", type: "dm" },
      text: "",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("empty_text");
  });

  it("not_connected when client undefined", async () => {
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: "@bot:matrix.org",
    });
    const result = await adapter.sendMessage({
      channel: { id: "!r:server", type: "dm" },
      text: "hi",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("not_connected");
  });

  it("sends via room id", async () => {
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: "@bot:matrix.org",
    });
    const client = makeMockClient();
    adapter._installClient(client);
    const result = await adapter.sendMessage({
      channel: { id: "!r:server", type: "dm" },
      text: "hi",
    });
    expect(result.ok).toBe(true);
    expect(client.sent[0]).toEqual({ roomId: "!r:server", text: "hi" });
  });

  it("resolves alias before sending (D419)", async () => {
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: "@bot:matrix.org",
    });
    const client = makeMockClient();
    client.resolved["#general:matrix.org"] = "!resolved:server";
    adapter._installClient(client);
    await adapter.sendMessage({
      channel: { id: "#general:matrix.org", type: "group" },
      text: "hi",
    });
    expect(client.sent[0]?.roomId).toBe("!resolved:server");
  });

  it("refuses E2EE room with encrypted_room_unsupported (D418)", async () => {
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: "@bot:matrix.org",
    });
    const client = makeMockClient();
    client.encryptedRooms.add("!enc:server");
    adapter._installClient(client);
    const result = await adapter.sendMessage({
      channel: { id: "!enc:server", type: "dm" },
      text: "hi",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("encrypted_room_unsupported");
    expect(client.sent).toHaveLength(0);
  });

  it("maps M_LIMIT_EXCEEDED to rate_limit", async () => {
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: "@bot:matrix.org",
    });
    const client = makeMockClient();
    client.failNextSendWith = { errcode: "M_LIMIT_EXCEEDED", message: "slow" };
    adapter._installClient(client);
    const result = await adapter.sendMessage({
      channel: { id: "!r:server", type: "dm" },
      text: "hi",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("rate_limit");
  });

  it("maps M_FORBIDDEN to permission_denied", async () => {
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: "@bot:matrix.org",
    });
    const client = makeMockClient();
    client.failNextSendWith = { errcode: "M_FORBIDDEN", message: "nope" };
    adapter._installClient(client);
    const result = await adapter.sendMessage({
      channel: { id: "!r:server", type: "dm" },
      text: "hi",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("permission_denied");
  });
});

describe("MatrixAdapter inbound dispatch", () => {
  it("dispatches a fresh event via timeline listener", async () => {
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: "@bot:matrix.org",
    });
    const client = makeMockClient();
    adapter._installClient(client);
    const received: MessageEvent[] = [];
    adapter.onInbound(async (ev) => {
      received.push(ev);
    });
    const listener = client.listeners[0];
    listener?.(makeEvent({ sender: "@alice:matrix.org", ts: Date.now() }), makeRoom(2));
    await new Promise((r) => setTimeout(r, 5));
    expect(received).toHaveLength(1);
    expect(received[0]?.platform).toBe("matrix");
    if (received[0]?.platform === "matrix") {
      expect(received[0].channel.type).toBe("dm");
    }
  });

  it("EC-3: ignores events older than 60s", async () => {
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: "@bot:matrix.org",
    });
    const client = makeMockClient();
    adapter._installClient(client);
    const handler = vi.fn(async () => undefined);
    adapter.onInbound(handler);
    const listener = client.listeners[0];
    listener?.(makeEvent({ sender: "@alice:matrix.org", ts: Date.now() - 90_000 }), makeRoom(2));
    await new Promise((r) => setTimeout(r, 5));
    expect(handler).not.toHaveBeenCalled();
  });

  it("loop guard: ignores bot's own messages", async () => {
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: "@bot:matrix.org",
    });
    const client = makeMockClient();
    adapter._installClient(client);
    const handler = vi.fn(async () => undefined);
    adapter.onInbound(handler);
    const listener = client.listeners[0];
    listener?.(makeEvent({ sender: "@bot:matrix.org", ts: Date.now() }), makeRoom(2));
    await new Promise((r) => setTimeout(r, 5));
    expect(handler).not.toHaveBeenCalled();
  });

  it("skips encrypted rooms (D418)", async () => {
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: "@bot:matrix.org",
    });
    const client = makeMockClient();
    client.encryptedRooms.add("!enc:server");
    adapter._installClient(client);
    const handler = vi.fn(async () => undefined);
    adapter.onInbound(handler);
    const listener = client.listeners[0];
    listener?.(makeEvent({ sender: "@alice:matrix.org", ts: Date.now() }), {
      roomId: "!enc:server",
      getJoinedMemberCount: () => 2,
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(handler).not.toHaveBeenCalled();
  });

  it("EC-H: onInbound replaces previous handler", async () => {
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: "@bot:matrix.org",
    });
    const client = makeMockClient();
    adapter._installClient(client);
    const a = vi.fn(async () => undefined);
    const b = vi.fn(async () => undefined);
    adapter.onInbound(a);
    adapter.onInbound(b);
    const listener = client.listeners[0];
    listener?.(makeEvent({ sender: "@alice:matrix.org", ts: Date.now() }), makeRoom(2));
    await new Promise((r) => setTimeout(r, 5));
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("handler throw isolated", async () => {
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: "@bot:matrix.org",
    });
    const client = makeMockClient();
    adapter._installClient(client);
    adapter.onInbound(async () => {
      throw new Error("boom");
    });
    const listener = client.listeners[0];
    expect(() =>
      listener?.(makeEvent({ sender: "@alice:matrix.org", ts: Date.now() }), makeRoom(2)),
    ).not.toThrow();
    await new Promise((r) => setTimeout(r, 5));
  });
});

describe("MatrixAdapter lifecycle", () => {
  it("disconnect is idempotent", async () => {
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: "@bot:matrix.org",
    });
    adapter._installClient(makeMockClient());
    await adapter.disconnect();
    await adapter.disconnect();
    // no throw is the assertion.
  });

  it("getClient returns the underlying client (escape hatch)", () => {
    const adapter = new MatrixAdapter({
      homeserverUrl: "https://matrix.org",
      accessToken: "t",
      userId: "@bot:matrix.org",
    });
    const client = makeMockClient();
    adapter._installClient(client);
    expect(adapter.getClient()).toBe(client);
  });
});
