import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MessageBus } from "../../src/a2a/message-bus.js";

/**
 * #365 — `MessageBus.send` discarded the handler's promise.
 *
 * `MessageHandler` may return a promise and `request` awaits it; only `send` dropped it. A
 * rejecting handler therefore became an **unhandled rejection**, which crashes Node under the
 * default `--unhandled-rejections=throw`, while `await bus.send(...)` resolved cleanly so the
 * sender had no way to observe the failure.
 *
 * The return VALUE is genuinely uninteresting for fire-and-forget. The rejection is not: silently
 * discarding it is the swallowed-error shape `error-handling.md` § 5 forbids.
 */

let unhandled: unknown[];
const capture = (reason: unknown): void => {
  unhandled.push(reason);
};

beforeEach(() => {
  unhandled = [];
  process.on("unhandledRejection", capture);
});

afterEach(() => {
  process.off("unhandledRejection", capture);
  vi.restoreAllMocks();
});

/** Lets the microtask queue drain so an unhandled rejection would have surfaced by now. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

it("does not leave a rejecting handler as an unhandled rejection", async () => {
  const bus = new MessageBus();
  bus.register("worker", async () => {
    throw new Error("handler blew up");
  });

  await bus.send("boss", "worker", { type: "ping", payload: 1 });
  await settle();

  expect(unhandled, "a rejecting fire-and-forget handler must not crash the process").toEqual([]);
});

it("reports the failure rather than discarding it", async () => {
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const bus = new MessageBus();
  bus.register("worker", async () => {
    throw new Error("handler blew up");
  });

  await bus.send("boss", "worker", { type: "ping", payload: 1 });
  await settle();

  // Fire-and-forget means the SENDER does not wait for the result. It does not mean nobody is
  // told the delivery failed — that is the difference between asynchronous and silent.
  const written = stderr.mock.calls.map((c) => String(c[0])).join("");
  expect(written).toContain("worker");
  expect(written).toContain("handler blew up");
});

it("still delivers to a handler that resolves, and still rejects for an unknown agent", async () => {
  // The accepted cases (`testing.md` § 4.2). A `send` that swallowed everything would pass both
  // tests above while breaking delivery and the unknown-agent contract.
  const bus = new MessageBus();
  const seen: unknown[] = [];
  bus.register("worker", async (m) => {
    seen.push(m.payload);
  });

  await bus.send("boss", "worker", { type: "ping", payload: 42 });
  await settle();

  expect(seen).toEqual([42]);
  await expect(bus.send("boss", "ghost", { type: "ping", payload: 1 })).rejects.toThrow(
    /not registered/,
  );
});
