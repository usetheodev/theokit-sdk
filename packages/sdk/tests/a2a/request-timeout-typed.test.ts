import { expect, it, vi } from "vitest";
import { A2ARequestTimeoutError, MessageBus } from "../../src/a2a/message-bus.js";

/*
 * #380 — `MessageBus.request` rejected a timeout with a plain `Error` and no `code`.
 *
 * `docs/error-codes.md` states this SDK's contract without qualification: "Branch on `code`, never
 * on the message: messages carry context (an id, a path, a limit) and change with it, while a code
 * is the contract." The timeout rejection carried neither, so the only way to identify it was to
 * match the message — the practice that same document tells consumers never to rely on. And the
 * message embeds `<to>` and `<n>ms`, so it changes with context exactly as the doc warns.
 *
 * It matters beyond tidiness because an unattended agent decides BY ITSELF whether to retry, and
 * the right decision differs by cause: a peer that did not answer in time is transient, a peer
 * whose handler threw is likely deterministic. With both arriving as an untyped `Error` the caller
 * either retries everything or retries nothing.
 */

const neverAnswers = () => new Promise<never>(() => {});

it("rejects a timeout with a typed error carrying a code", async () => {
  vi.useFakeTimers();
  try {
    const bus = new MessageBus();
    bus.register("slow", neverAnswers);

    const pending = bus.request("boss", "slow", { type: "ping", payload: 1 }, { timeoutMs: 50 });
    const settled = expect(pending).rejects.toBeInstanceOf(A2ARequestTimeoutError);
    await vi.advanceTimersByTimeAsync(60);
    await settled;
  } finally {
    vi.useRealTimers();
  }
});

it("carries the code, the peer and the limit as fields, not as prose", async () => {
  vi.useFakeTimers();
  try {
    const bus = new MessageBus();
    bus.register("slow", neverAnswers);

    const pending = bus.request("boss", "slow", { type: "ping", payload: 1 }, { timeoutMs: 50 });
    const captured = pending.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(60);
    const error = (await captured) as A2ARequestTimeoutError;

    expect(error.code).toBe("a2a_request_timeout");
    expect(error.to).toBe("slow");
    expect(error.timeoutMs).toBe(50);
    // The message is still legible for a human reading a log; it is simply no longer the only
    // way to identify the failure.
    expect(error.message).toContain("slow");
  } finally {
    vi.useRealTimers();
  }
});

it("leaves a handler failure distinguishable from a timeout", async () => {
  // The accepted case (`testing.md` § 4.2), and the distinction the issue is actually about: a
  // retry policy is built on telling these two apart. An error type slapped on every rejection
  // would satisfy the tests above while destroying exactly what they are for.
  const bus = new MessageBus();
  bus.register("broken", async () => {
    throw new Error("handler blew up");
  });

  const error = await bus
    .request("boss", "broken", { type: "ping", payload: 1 })
    .catch((e: unknown) => e);

  expect(error).not.toBeInstanceOf(A2ARequestTimeoutError);
  expect((error as { code?: string }).code).toBeUndefined();
});

it("still resolves a peer that answers in time", async () => {
  const bus = new MessageBus();
  bus.register("fast", async () => "pong");

  await expect(bus.request("boss", "fast", { type: "ping", payload: 1 })).resolves.toBe("pong");
});
