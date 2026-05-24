/**
 * `TeamsAdapter` tests (T1.3 + EC-1, EC-7).
 */

import { BasePlatformAdapter } from "@usetheo/gateway";
import { describe, expect, it, vi } from "vitest";

import { TeamsAdapter } from "../src/adapter.js";

/** Minimal fake App matching the TeamsAppLike contract from adapter.ts. */
function makeFakeApp() {
  const handlers: Record<string, (e: unknown) => Promise<void> | void> = {};
  let started = false;
  return {
    initialize: vi.fn(async () => {}),
    start: vi.fn(async () => {
      started = true;
    }),
    stop: vi.fn(async () => {
      started = false;
    }),
    send: vi.fn(async (_conversationId: string, _activity: unknown) => ({ id: "sent-1" })),
    on: vi.fn((name: string, cb: (e: unknown) => void | Promise<void>) => {
      handlers[name] = cb;
    }),
    /** Test helper — invoke the registered "activity" handler with a synthetic event. */
    _emit(name: string, event: unknown) {
      return handlers[name]?.(event);
    },
    get _started() {
      return started;
    },
    get _handlers() {
      return handlers;
    },
  };
}

function makeAdapter(opts: { botDisplayName?: string } = {}) {
  const fakeApp = makeFakeApp();
  const adapter = new TeamsAdapter({
    clientId: "client-1",
    clientSecret: "secret-1",
    tenantId: "tenant-1",
    botDisplayName: opts.botDisplayName,
    __appFactory: () => fakeApp as never,
  });
  return { adapter, fakeApp };
}

describe("TeamsAdapter — Base contract", () => {
  it("test_adapter_is_base_platform_adapter", () => {
    const { adapter } = makeAdapter();
    expect(adapter).toBeInstanceOf(BasePlatformAdapter);
  });

  it("test_adapter_platform_is_teams", () => {
    const { adapter } = makeAdapter();
    expect(adapter.platform).toBe("teams");
  });
});

describe("TeamsAdapter — Constructor validation (EC-1)", () => {
  it("test_adapter_constructor_validates_non_empty (EC-1) — empty clientId throws", () => {
    expect(() => {
      new TeamsAdapter({
        clientId: "",
        clientSecret: "s",
        tenantId: "t",
      });
    }).toThrow(/clientId/);
  });

  it("test_adapter_constructor_validates_empty_secret", () => {
    expect(() => {
      new TeamsAdapter({
        clientId: "c",
        clientSecret: "",
        tenantId: "t",
      });
    }).toThrow(/clientSecret/);
  });

  it("test_adapter_constructor_validates_empty_tenant", () => {
    expect(() => {
      new TeamsAdapter({
        clientId: "c",
        clientSecret: "s",
        tenantId: "",
      });
    }).toThrow(/tenantId/);
  });

  it("constructor accepts valid non-empty options", () => {
    expect(() => {
      new TeamsAdapter({
        clientId: "c",
        clientSecret: "s",
        tenantId: "t",
        __appFactory: () => ({}) as never,
      });
    }).not.toThrow();
  });
});

describe("TeamsAdapter — lifecycle", () => {
  it("test_connect_returns_true_on_success", async () => {
    const { adapter, fakeApp } = makeAdapter();
    expect(await adapter.connect()).toBe(true);
    expect(fakeApp.initialize).toHaveBeenCalledTimes(1);
  });

  it("test_connect_idempotent — second call returns true without re-init", async () => {
    const { adapter, fakeApp } = makeAdapter();
    await adapter.connect();
    await adapter.connect();
    expect(fakeApp.initialize).toHaveBeenCalledTimes(1);
  });

  it("test_connect_returns_false_on_init_failure", async () => {
    const failApp = makeFakeApp();
    failApp.initialize = vi.fn(async () => {
      throw new Error("init failed");
    });
    const adapter = new TeamsAdapter({
      clientId: "c",
      clientSecret: "s",
      tenantId: "t",
      __appFactory: () => failApp as never,
    });
    expect(await adapter.connect()).toBe(false);
  });

  it("test_disconnect_idempotent — second call is noop", async () => {
    const { adapter } = makeAdapter();
    await adapter.connect();
    await adapter.disconnect();
    await adapter.disconnect();
    // No throw.
  });

  it("test_disconnect_clears_seen_conversations", async () => {
    const { adapter, fakeApp } = makeAdapter();
    await adapter.connect();
    adapter.onInbound(async () => {});
    await fakeApp._emit("activity", {
      activity: {
        type: "message",
        id: "act-1",
        text: "hi",
        conversation: { id: "conv-1", conversationType: "personal" },
        from: { id: "u1" },
      },
    });
    expect(adapter._seenConversationsSize).toBe(1);
    await adapter.disconnect();
    expect(adapter._seenConversationsSize).toBe(0);
  });
});

describe("TeamsAdapter — onInbound + dispatch", () => {
  it("test_adapter_oninbound_replaces (EC-H)", async () => {
    const { adapter, fakeApp } = makeAdapter();
    await adapter.connect();
    const h1 = vi.fn(async () => {});
    const h2 = vi.fn(async () => {});
    adapter.onInbound(h1);
    adapter.onInbound(h2);
    await fakeApp._emit("activity", {
      activity: {
        type: "message",
        id: "act-1",
        text: "hi",
        conversation: { id: "conv-1", conversationType: "personal" },
        from: { id: "u1" },
      },
    });
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it("filters non-message activities (typing, conversationUpdate)", async () => {
    const { adapter, fakeApp } = makeAdapter();
    await adapter.connect();
    const h = vi.fn(async () => {});
    adapter.onInbound(h);
    await fakeApp._emit("activity", {
      activity: { type: "typing", conversation: { id: "c" } },
    });
    await fakeApp._emit("activity", {
      activity: { type: "conversationUpdate", conversation: { id: "c" } },
    });
    expect(h).not.toHaveBeenCalled();
  });

  it("test_adapter_seenConversations_caps_at_max (EC-5 downgraded)", async () => {
    const { adapter, fakeApp } = makeAdapter();
    await adapter.connect();
    adapter.onInbound(async () => {});
    // Push 1005 distinct conversation ids.
    for (let i = 0; i < 1005; i += 1) {
      await fakeApp._emit("activity", {
        activity: {
          type: "message",
          id: `act-${i}`,
          text: "hi",
          conversation: { id: `conv-${i}`, conversationType: "personal" },
          from: { id: "u1" },
        },
      });
    }
    expect(adapter._seenConversationsSize).toBeLessThanOrEqual(1000);
  });
});

describe("TeamsAdapter — sendMessage", () => {
  it("test_adapter_send_with_empty_text_returns_error", async () => {
    const { adapter } = makeAdapter();
    await adapter.connect();
    const r = await adapter.sendMessage({
      channel: { id: "c", type: "dm" },
      text: "",
    });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("empty_text");
  });

  it("test_adapter_send_not_connected_returns_error", async () => {
    const { adapter } = makeAdapter();
    const r = await adapter.sendMessage({
      channel: { id: "c", type: "dm" },
      text: "hi",
    });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("not_connected");
  });

  it("test_adapter_send_short_message_one_send_call", async () => {
    const { adapter, fakeApp } = makeAdapter();
    await adapter.connect();
    const r = await adapter.sendMessage({
      channel: { id: "conv-1", type: "dm" },
      text: "hi",
    });
    expect(r.ok).toBe(true);
    expect(fakeApp.send).toHaveBeenCalledTimes(1);
    expect(fakeApp.send).toHaveBeenCalledWith("conv-1", { type: "message", text: "hi" });
  });

  it("test_adapter_send_app_throws_returns_error", async () => {
    const { adapter, fakeApp } = makeAdapter();
    await adapter.connect();
    fakeApp.send = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const r = await adapter.sendMessage({
      channel: { id: "c", type: "dm" },
      text: "hi",
    });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("server_error"); // EC-7: network error mapped
  });

  it("test_adapter_send_returns_last_activity_id", async () => {
    const { adapter, fakeApp } = makeAdapter();
    await adapter.connect();
    let i = 0;
    fakeApp.send = vi.fn(async () => ({ id: `act-${++i}` }));
    // Force split: 8500-char text.
    const r = await adapter.sendMessage({
      channel: { id: "c", type: "dm" },
      text: "a".repeat(8500),
    });
    expect(r.ok).toBe(true);
    expect(r.messageId).toBe(`act-${i}`); // last call's id
    expect((fakeApp.send as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
