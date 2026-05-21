/**
 * Tests for GatewayRunner (T1.3, ADRs D170+ family + EC-A/D/E/F/G/H).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { GatewayRunner } from "../../src/runner/gateway-runner.js";
import type { MessageEvent } from "../../src/types/message-event.js";
import { MockAdapter } from "../adapter/mock-adapter.js";

function tg(text = "hi", chatId = 1): MessageEvent {
  return {
    id: `tg-${chatId}-${text.length}`,
    platform: "telegram",
    sender: { id: "100" },
    channel: { id: String(chatId), type: "dm" },
    text,
    receivedAt: 0,
    telegram: { chatId, messageId: 1, raw: {} },
  };
}

function dc(text = "hi"): MessageEvent {
  return {
    id: "dc-1",
    platform: "discord",
    sender: { id: "uA" },
    channel: { id: "cA", type: "dm" },
    text,
    receivedAt: 0,
    discord: { guildId: null, channelId: "cA", messageId: "m", raw: {} },
  };
}

describe("GatewayRunner (T1.3)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("start connects all adapters", async () => {
    const a = new MockAdapter("telegram");
    const b = new MockAdapter("discord");
    const runner = new GatewayRunner({ adapters: [a, b], handler: async () => {} });
    await runner.start();
    expect(a.connected).toBe(true);
    expect(b.connected).toBe(true);
    await runner.stop();
  });

  it("inbound dispatches to handler", async () => {
    const a = new MockAdapter("telegram");
    let received: MessageEvent | undefined;
    const runner = new GatewayRunner({
      adapters: [a],
      handler: async (event) => {
        received = event;
      },
    });
    await runner.start();
    await a.emit(tg());
    expect(received?.text).toBe("hi");
    await runner.stop();
  });

  it("handler throw does not crash runner", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const a = new MockAdapter("telegram");
    const runner = new GatewayRunner({
      adapters: [a],
      handler: async () => {
        throw new Error("boom");
      },
    });
    await runner.start();
    await a.emit(tg());
    // No throw escapes — test passes if we reach here.
    expect(a.connected).toBe(true);
    await runner.stop();
    stderr.mockRestore();
  });

  it("stop disconnects all adapters", async () => {
    const a = new MockAdapter("telegram");
    const b = new MockAdapter("discord");
    const runner = new GatewayRunner({ adapters: [a, b], handler: async () => {} });
    await runner.start();
    await runner.stop();
    expect(a.connected).toBe(false);
    expect(b.connected).toBe(false);
  });

  it("stop is idempotent", async () => {
    const a = new MockAdapter("telegram");
    const runner = new GatewayRunner({ adapters: [a], handler: async () => {} });
    await runner.start();
    await runner.stop();
    await runner.stop();
    expect(a.disconnectCount).toBe(1);
  });

  it("EC-G: ctx.reply routes to adapter matching event.platform", async () => {
    const tgA = new MockAdapter("telegram");
    const dcA = new MockAdapter("discord");
    const runner = new GatewayRunner({
      adapters: [tgA, dcA],
      handler: async (event, ctx) => {
        await ctx.reply(`got ${event.text}`);
      },
    });
    await runner.start();
    await tgA.emit(tg("ping"));
    await dcA.emit(dc("hello"));
    expect(tgA.sent.map((s) => s.text)).toEqual(["got ping"]);
    expect(dcA.sent.map((s) => s.text)).toEqual(["got hello"]);
    await runner.stop();
  });

  it("EC-D: block:true with message triggers reply then short-circuits", async () => {
    const a = new MockAdapter("telegram");
    let handlerCalled = false;
    const runner = new GatewayRunner({
      adapters: [a],
      handler: async () => {
        handlerCalled = true;
      },
      hooks: [
        {
          name: "deny",
          pre_inbound: () => ({ block: true, message: "rate-limited" }),
        },
      ],
    });
    await runner.start();
    await a.emit(tg());
    expect(a.sent.map((s) => s.text)).toEqual(["rate-limited"]);
    expect(handlerCalled).toBe(false);
    await runner.stop();
  });

  it("EC-D negative: block:true without message short-circuits silently", async () => {
    const a = new MockAdapter("telegram");
    let handlerCalled = false;
    const runner = new GatewayRunner({
      adapters: [a],
      handler: async () => {
        handlerCalled = true;
      },
      hooks: [{ name: "deny", pre_inbound: () => ({ block: true }) }],
    });
    await runner.start();
    await a.emit(tg());
    expect(a.sent).toHaveLength(0);
    expect(handlerCalled).toBe(false);
    await runner.stop();
  });

  it("EC-E: stop drains in-flight handlers before disconnect", async () => {
    const a = new MockAdapter("telegram");
    let handlerDone = false;
    const runner = new GatewayRunner({
      adapters: [a],
      handler: async () => {
        await new Promise((r) => setTimeout(r, 50));
        handlerDone = true;
      },
    });
    await runner.start();
    const inflight = a.emit(tg());
    // Initiate stop while handler is mid-flight.
    const stopP = runner.stop();
    await Promise.all([inflight, stopP]);
    expect(handlerDone).toBe(true);
  });

  it("EC-E: stop force-disconnects after drain timeout", async () => {
    const a = new MockAdapter("telegram");
    const runner = new GatewayRunner({
      adapters: [a],
      handler: async () => {
        // Hang past the drain timeout.
        await new Promise((r) => setTimeout(r, 500));
      },
      drainTimeoutMs: 50,
    });
    await runner.start();
    // Emit but don't await — handler will hang for 500ms.
    void a.emit(tg());
    const t0 = Date.now();
    await runner.stop();
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(300);
    expect(a.connected).toBe(false);
  });

  it("EC-F: handler error logs are redacted", async () => {
    const writes: string[] = [];
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((s: string | Uint8Array) => {
        writes.push(typeof s === "string" ? s : Buffer.from(s).toString("utf8"));
        return true;
      });
    const a = new MockAdapter("telegram");
    const runner = new GatewayRunner({
      adapters: [a],
      handler: async () => {
        // Include something that looks like a token.
        throw new Error("auth failed bearer sk-abc123def456ghi789jkl");
      },
    });
    await runner.start();
    await a.emit(tg());
    await runner.stop();
    const combined = writes.join("");
    expect(combined).toContain("handler error");
    // The literal token string should NOT appear unredacted.
    expect(combined).not.toContain("sk-abc123def456ghi789jkl");
    stderr.mockRestore();
  });

  it("EC-A: /skill does not shadow /skills (word-boundary match)", async () => {
    const a = new MockAdapter("telegram");
    const calls: string[] = [];
    const runner = new GatewayRunner({
      adapters: [a],
      handler: async () => {
        calls.push("default");
      },
    });
    runner.command("skill", async () => {
      calls.push("/skill");
    });
    runner.command("skills", async () => {
      calls.push("/skills");
    });
    await runner.start();
    await a.emit(tg("/skills"));
    await a.emit(tg("/skill foo"));
    await a.emit(tg("/skill"));
    expect(calls).toEqual(["/skills", "/skill", "/skill"]);
    await runner.stop();
  });

  it("EC-A: slash command with @botname suffix matches", async () => {
    const a = new MockAdapter("telegram");
    const calls: string[] = [];
    const runner = new GatewayRunner({
      adapters: [a],
      handler: async () => {},
    });
    runner.command("help", async () => {
      calls.push("/help");
    });
    await runner.start();
    await a.emit(tg("/help@theo_paulo_bot"));
    expect(calls).toEqual(["/help"]);
    await runner.stop();
  });
});
