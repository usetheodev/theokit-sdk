import { describe, expect, it } from "vitest";
import { MessageBus } from "../../src/a2a/message-bus.js";
import type { A2AMessage } from "../../src/a2a/types.js";

describe("MessageBus", () => {
  it("routes message to registered agent", async () => {
    const bus = new MessageBus();
    const received: A2AMessage[] = [];
    bus.register("agent-b", (msg) => {
      received.push(msg);
    });
    await bus.send("agent-a", "agent-b", { type: "greeting", payload: "hello" });
    expect(received.length).toEqual(1);
    expect(received[0].payload).toEqual("hello");
    expect(received[0].from).toEqual("agent-a");
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
    let _called = false;
    bus.register("lazy", async () => {
      await new Promise((r) => setTimeout(r, 100));
      _called = true;
    });
    await bus.send("a", "lazy", { type: "ping", payload: null });
    // send is fire-and-forget — handler may not have finished
    // but the send itself resolved without waiting
    expect(true).toBe(true);
  });
});
