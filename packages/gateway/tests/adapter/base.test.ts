/**
 * Tests for `BasePlatformAdapter` contract (T1.2, ADR D172 + EC-H).
 */

import { describe, expect, it } from "vitest";

import type { MessageEvent } from "../../src/types/message-event.js";
import { MockAdapter } from "./mock-adapter.js";

function ev(platform: "telegram" = "telegram"): MessageEvent {
  return {
    id: "1",
    platform,
    sender: { id: "u" },
    channel: { id: "c", type: "dm" },
    text: "hi",
    receivedAt: 0,
    telegram: { chatId: 1, messageId: 1, raw: {} },
  };
}

describe("BasePlatformAdapter (T1.2)", () => {
  it("connect is idempotent", async () => {
    const a = new MockAdapter();
    expect(await a.connect()).toBe(true);
    expect(await a.connect()).toBe(true);
    expect(a.connected).toBe(true);
  });

  it("send returns SendResult object on success", async () => {
    const a = new MockAdapter();
    const r = await a.sendMessage({ channel: { id: "c", type: "dm" }, text: "hi" });
    expect(r.ok).toBe(true);
    expect(r.messageId).toBeDefined();
  });

  it("send with empty text returns error, does not throw", async () => {
    const a = new MockAdapter();
    const r = await a.sendMessage({ channel: { id: "c", type: "dm" }, text: "" });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("empty_text");
  });

  it("onInbound subscribe + unsubscribe stops handler", async () => {
    const a = new MockAdapter();
    let count = 0;
    const unsub = a.onInbound(async () => {
      count += 1;
    });
    await a.emit(ev());
    expect(count).toBe(1);
    unsub();
    await a.emit(ev());
    expect(count).toBe(1);
  });

  it("disconnect is idempotent (safe on never-connected)", async () => {
    const a = new MockAdapter();
    await a.disconnect();
    await a.disconnect();
    expect(a.disconnectCount).toBe(2);
    expect(a.connected).toBe(false);
  });

  it("EC-H: onInbound second call REPLACES previous handler (not stacks)", async () => {
    const a = new MockAdapter();
    const calls: string[] = [];
    a.onInbound(async () => {
      calls.push("first");
    });
    a.onInbound(async () => {
      calls.push("second");
    });
    await a.emit(ev());
    expect(calls).toEqual(["second"]);
  });
});
