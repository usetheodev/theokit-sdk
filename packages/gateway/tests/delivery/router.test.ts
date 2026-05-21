/**
 * Tests for DeliveryRouter (T3.1, ADR D175).
 */

import { describe, expect, it } from "vitest";

import { DeliveryRouter } from "../../src/delivery/router.js";
import { MockAdapter } from "../adapter/mock-adapter.js";

describe("DeliveryRouter (T3.1)", () => {
  it("register adapter and send routes to it", async () => {
    const router = new DeliveryRouter();
    const tg = new MockAdapter("telegram");
    router.register(tg);
    const r = await router.send({
      platform: "telegram",
      channel: { id: "c", type: "dm" },
      text: "hi",
    });
    expect(r.ok).toBe(true);
    expect(tg.sent).toHaveLength(1);
    expect(tg.sent[0]?.text).toBe("hi");
  });

  it("register replaces existing adapter for same platform", async () => {
    const router = new DeliveryRouter();
    const a = new MockAdapter("telegram");
    const b = new MockAdapter("telegram");
    router.register(a);
    router.register(b);
    await router.send({ platform: "telegram", channel: { id: "c", type: "dm" }, text: "hi" });
    expect(a.sent).toHaveLength(0);
    expect(b.sent).toHaveLength(1);
  });

  it("send to multi-adapter setup routes correctly", async () => {
    const router = new DeliveryRouter();
    const tg = new MockAdapter("telegram");
    const dc = new MockAdapter("discord");
    router.register(tg);
    router.register(dc);

    await router.send({ platform: "telegram", channel: { id: "c", type: "dm" }, text: "tg" });
    await router.send({ platform: "discord", channel: { id: "c", type: "dm" }, text: "dc" });

    expect(tg.sent[0]?.text).toBe("tg");
    expect(dc.sent[0]?.text).toBe("dc");
  });

  it("send to unknown platform returns no_adapter error", async () => {
    const router = new DeliveryRouter();
    const r = await router.send({
      platform: "telegram",
      channel: { id: "c", type: "dm" },
      text: "hi",
    });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("no_adapter");
  });

  it("send does not throw on adapter error", async () => {
    const router = new DeliveryRouter();
    const a = new MockAdapter("telegram");
    a.failNextSend = { code: "rate_limited", message: "retry in 30s" };
    router.register(a);
    const r = await router.send({
      platform: "telegram",
      channel: { id: "c", type: "dm" },
      text: "hi",
    });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("rate_limited");
  });
});
