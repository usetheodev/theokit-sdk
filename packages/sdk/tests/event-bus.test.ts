import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../src/event-bus.js";

type TestEvents = {
  message: string;
  count: number;
};

describe("EventBus", () => {
  it("delivers published payload to subscriber", () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    bus.subscribe("message", handler);
    bus.publish("message", "hello");
    expect(handler).toHaveBeenCalledWith("hello");
  });

  it("supports multiple subscribers for the same event", () => {
    const bus = new EventBus<TestEvents>();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.subscribe("message", h1);
    bus.subscribe("message", h2);
    bus.publish("message", "x");
    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it("unsubscribe stops delivery", () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    const unsub = bus.subscribe("message", handler);
    unsub();
    bus.publish("message", "after-unsub");
    expect(handler).not.toHaveBeenCalled();
  });

  it("once fires handler exactly once", () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    bus.once("count", handler);
    bus.publish("count", 1);
    bus.publish("count", 2);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(1);
  });

  it("EC-2: one failing handler does not break others", () => {
    const bus = new EventBus<TestEvents>();
    const bad = vi.fn(() => {
      throw new Error("boom");
    });
    const good = vi.fn();
    bus.subscribe("message", bad);
    bus.subscribe("message", good);
    bus.publish("message", "test");
    expect(bad).toHaveBeenCalled();
    expect(good).toHaveBeenCalledWith("test");
  });

  it("publish to event with no subscribers is a no-op", () => {
    const bus = new EventBus<TestEvents>();
    expect(() => bus.publish("message", "noop")).not.toThrow();
  });
});
