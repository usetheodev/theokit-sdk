/**
 * M3 #64 (T1.2) — RED-first: EventBus must NOT silently swallow a throwing handler.
 * It logs the error (event key + message) to stderr and increments an observable
 * counter, while preserving the EC-2 contract (sibling handlers still fire).
 */
import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../src/event-bus.js";

interface Events extends Record<string, unknown> {
  ping: { n: number };
}

describe("M3 #64 — EventBus fails loud on handler error", () => {
  it("logs a throwing handler (event key + error) and still fires siblings", () => {
    const bus = new EventBus<Events>();
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let siblingFired = false;

    bus.subscribe("ping", () => {
      throw new Error("boom-handler");
    });
    bus.subscribe("ping", () => {
      siblingFired = true;
    });

    bus.publish("ping", { n: 1 });

    // Sibling still fired (EC-2 preserved).
    expect(siblingFired).toBe(true);
    // The swallowed error is now logged with the event key + message (fail-loud).
    const logged = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(logged).toContain("ping");
    expect(logged).toContain("boom-handler");
    // And observable via the counter.
    expect(bus.handlerErrorCount).toBe(1);
    stderr.mockRestore();
  });

  it("does not log or count when handlers succeed", () => {
    const bus = new EventBus<Events>();
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    bus.subscribe("ping", () => undefined);
    bus.publish("ping", { n: 1 });
    expect(bus.handlerErrorCount).toBe(0);
    expect(stderr).not.toHaveBeenCalled();
    stderr.mockRestore();
  });
});
