import { describe, expect, it, vi } from "vitest";
import { A2APeerNotRegisteredError, MessageBus } from "../../src/a2a/message-bus.js";
import type { A2AMessage } from "../../src/a2a/types.js";
import { TheokitAgentError } from "../../src/errors.js";

describe("MessageBus", () => {
  it("clears the timeout timer when the handler resolves (no leaked timer keeps the loop alive)", async () => {
    vi.useFakeTimers();
    try {
      const bus = new MessageBus();
      bus.register("worker", () => "pong");
      const reply = await bus.request("supervisor", "worker", { type: "ping", payload: null });
      expect(reply).toBe("pong");
      // The 30s timeout timer MUST be cleared once the request settles — otherwise it
      // keeps the Node event loop alive and the process hangs after a successful request.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("routes message to registered agent", async () => {
    const bus = new MessageBus();
    const received: A2AMessage[] = [];
    bus.register("agent-b", (msg) => {
      received.push(msg);
    });
    await bus.send("agent-a", "agent-b", { type: "greeting", payload: "hello" });
    expect(received.length).toEqual(1);
    expect(received[0]!.payload).toEqual("hello");
    expect(received[0]!.from).toEqual("agent-a");
  });

  it("request/response returns typed response", async () => {
    const bus = new MessageBus();
    bus.register("calculator", async () => ({ result: 42 }));
    const response = await bus.request("caller", "calculator", {
      type: "compute",
      payload: { op: "add" },
    });
    expect(response).toEqual({ result: 42 });
  });

  it("send to unregistered agent throws", async () => {
    const bus = new MessageBus();
    await expect(bus.send("a", "ghost", { type: "x", payload: null })).rejects.toThrow(
      "not registered",
    );
  });

  it("unregister removes the agent", async () => {
    const bus = new MessageBus();
    bus.register("temp", () => {});
    bus.unregister("temp");
    await expect(bus.send("a", "temp", { type: "x", payload: null })).rejects.toThrow(
      "not registered",
    );
  });

  it("request times out if handler never responds", async () => {
    const bus = new MessageBus();
    bus.register("slow", async () => {
      await new Promise((r) => setTimeout(r, 5000));
    });
    await expect(
      bus.request("caller", "slow", { type: "x", payload: null }, { timeoutMs: 50 }),
    ).rejects.toThrow("timeout");
  });

  it("fire-and-forget does not wait for handler", async () => {
    const bus = new MessageBus();
    let handled = false;
    bus.register("lazy", async () => {
      await new Promise((r) => setTimeout(r, 100));
      handled = true;
    });
    // B-063. This used to end in `expect(true).toBe(true)`, so the test named a timing property and
    // observed nothing: making `send` await the 100ms handler left it green. `handled` is the
    // oracle — it is still false only because `send` returned before the handler did.
    //
    // An earlier version of this fix also bounded `Date.now()` elapsed under 50ms. That was
    // dropped: it kills no mutant this assertion does not already kill, and it puts a wall clock
    // in a unit test, which `.claude/rules/testing.md` § 6 names as an anti-pattern.
    await bus.send("a", "lazy", { type: "ping", payload: null });

    expect(handled, "send must resolve without waiting for the 100ms handler").toBe(false);
  });
});

describe("MessageBus — an unregistered peer is a typed failure (#380 sibling)", () => {
  // The timeout branch of these same two methods got A2ARequestTimeoutError, with a docstring quoting
  // docs/error-codes.md — "branch on `code`, never on the message". The FIRST branch of both kept
  // throwing a bare Error whose message embedded the address, which is the exact shape that quote
  // rejects, so a caller had no way to distinguish "nobody is listening" from any other failure.

  it("send rejects with A2APeerNotRegisteredError carrying the address", async () => {
    const bus = new MessageBus();
    const err = await bus.send("a", "ghost", { type: "ping", payload: {} }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(A2APeerNotRegisteredError);
    expect(err).toBeInstanceOf(TheokitAgentError);
    expect((err as A2APeerNotRegisteredError).code).toBe("a2a_peer_not_registered");
    expect((err as A2APeerNotRegisteredError).to).toBe("ghost");
    expect((err as A2APeerNotRegisteredError).isRetryable, "a peer registers or it does not").toBe(
      false,
    );
  });

  it("request rejects the same way, so a caller branches once", async () => {
    const bus = new MessageBus();
    const err = await bus.request("a", "ghost", { type: "ping", payload: {} }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(A2APeerNotRegisteredError);
    expect((err as A2APeerNotRegisteredError).to).toBe("ghost");
  });
});
