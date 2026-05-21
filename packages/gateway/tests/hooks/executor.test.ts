/**
 * Tests for HookExecutor (T4.1, ADRs D176/D177).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import type { GatewayHook } from "../../src/hooks/types.js";
import { HookExecutor } from "../../src/hooks/types.js";
import type { MessageEvent } from "../../src/types/message-event.js";

const ev: MessageEvent = {
  id: "1",
  platform: "telegram",
  sender: { id: "u" },
  channel: { id: "c", type: "dm" },
  text: "hi",
  receivedAt: 0,
  telegram: { chatId: 1, messageId: 1, raw: {} },
};

describe("HookExecutor (T4.1)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("empty hooks returns unblocked", async () => {
    const ex = new HookExecutor([]);
    const d = await ex.firePreInbound({ event: ev });
    expect(d.block).toBe(false);
  });

  it("first block short-circuits the chain", async () => {
    const calls: string[] = [];
    const hooks: GatewayHook[] = [
      {
        name: "first",
        pre_inbound: () => {
          calls.push("first");
          return { block: true, message: "no" };
        },
      },
      {
        name: "second",
        pre_inbound: () => {
          calls.push("second");
        },
      },
    ];
    const d = await new HookExecutor(hooks).firePreInbound({ event: ev });
    expect(d.block).toBe(true);
    expect(d.message).toBe("no");
    expect(calls).toEqual(["first"]);
  });

  it("hook throw is treated as block", async () => {
    const hooks: GatewayHook[] = [
      {
        name: "bad",
        pre_inbound: () => {
          throw new Error("boom");
        },
      },
    ];
    const d = await new HookExecutor(hooks).firePreInbound({ event: ev });
    expect(d.block).toBe(true);
    expect(d.message).toContain("boom");
  });

  it("undefined decision is treated as continue", async () => {
    const hooks: GatewayHook[] = [{ name: "neutral", pre_inbound: () => undefined }];
    const d = await new HookExecutor(hooks).firePreInbound({ event: ev });
    expect(d.block).toBe(false);
  });

  it("post_outbound fires all hooks even when one throws", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const calls: string[] = [];
    const hooks: GatewayHook[] = [
      {
        name: "first",
        post_outbound: () => {
          calls.push("first");
          throw new Error("ouch");
        },
      },
      {
        name: "second",
        post_outbound: () => {
          calls.push("second");
        },
      },
    ];
    await new HookExecutor(hooks).firePostOutbound({
      event: ev,
      outbound: { channel: ev.channel, text: "x" },
      result: { ok: true },
    });
    expect(calls).toEqual(["first", "second"]);
    stderr.mockRestore();
  });

  it("on_error fires all hooks", async () => {
    const calls: string[] = [];
    const hooks: GatewayHook[] = [
      {
        name: "a",
        on_error: () => {
          calls.push("a");
        },
      },
      {
        name: "b",
        on_error: () => {
          calls.push("b");
        },
      },
    ];
    await new HookExecutor(hooks).fireOnError({ event: ev, error: new Error("x") });
    expect(calls).toEqual(["a", "b"]);
  });
});
