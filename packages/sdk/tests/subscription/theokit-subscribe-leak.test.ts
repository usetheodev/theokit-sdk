/**
 * B-131 — the transport-cleanup counterpart to `leaky-generators.test.ts` (B-105).
 *
 * `tests/load/1000-concurrent-sse.test.ts` asserted "does not leak CLOSE_WAIT sockets" by shelling
 * `ss -tnp` against a raw `node:net` driver with no `src/` code in it at all. Measured (B-131):
 * deleting the driver's own `client.socket.destroy()` entirely left CLOSE_WAIT at 0 at both 100 and
 * 1000 concurrency, because Node's `net.Socket` defaults to `allowHalfOpen: false` (completes the FIN
 * handshake on its own) and the fixture server's `keepAliveTimeout` closes idle sockets — neither
 * mechanism depends on any code this repo owns. The assertion had no power to detect a leak.
 *
 * This file drives the SDK path that ACTUALLY owns connection lifetime — `Theokit.subscribe`'s two
 * transports — with fetch/WebSocket injected via `opts.fetch` / `opts.WebSocket` (B-108), no network,
 * no `ss`, no OS-dependent auto-close semantics to hide behind. The oracle is "was the underlying
 * resource released", read directly off a spy, exactly as `leaky-generators.test.ts` reads the SDK's
 * own subscriber count instead of asking a `FinalizationRegistry` to maybe fire.
 *
 * Mutation-verified, not argued: commenting out `openWs`'s `finally { ws.close() }` turns the WS case
 * RED; commenting out the SSE reader's `.cancel()` (added by this change — see the fix below) turns
 * the SSE case RED. See `knowledge-base/discoveries/` note in the run log for the recorded RED/GREEN
 * transcript.
 *
 * The SSE fix: `streamToAsyncIterable`'s `finally` previously called only `reader.releaseLock()`.
 * Per the WHATWG Streams spec, `releaseLock()` detaches the reader WITHOUT canceling the stream — the
 * underlying `fetch` response body (and its socket) stays open until something else cancels or reads
 * it to completion. `openWs` already got this right (`ws.close()` in `finally`); the SSE path did
 * not have an equivalent. Fixed by also calling `reader.cancel()` before releasing the lock.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { subscribe } from "../../src/subscription/theokit-subscribe.js";

afterEach(() => vi.unstubAllGlobals());

const BASE = "https://api.test";

describe("SSE transport — the underlying stream is released, not just detached", () => {
  it("test_breaking_out_of_for_await_cancels_the_underlying_reader", async () => {
    const cancelSpy = vi.fn(async () => undefined);
    let releaseLockCalls = 0;
    let pullCount = 0;

    // A ReadableStream stand-in that never ends on its own — the same shape as an open SSE
    // connection the consumer walks away from mid-stream. If nothing cancels it, "done" never
    // becomes true.
    const encoder = new TextEncoder();
    const fakeReader = {
      read: vi.fn(async () => {
        pullCount += 1;
        // Every pull delivers one complete SSE frame so the parser always has something to yield.
        return { done: false, value: encoder.encode(`data: ${pullCount}\n\n`) };
      }),
      cancel: cancelSpy,
      releaseLock: vi.fn(() => {
        releaseLockCalls += 1;
      }),
    };
    const fakeBody = { getReader: () => fakeReader };
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      body: fakeBody,
    }));

    const gen = subscribe<unknown, { tick: number }>(
      "feed",
      {},
      {
        baseUrl: BASE,
        transport: "sse",
        maxReconnectAttempts: 0,
        fetch: fetchSpy as unknown as typeof fetch,
      },
    );

    let received = 0;
    for await (const _value of gen) {
      received += 1;
      break;
    }

    expect(received, "the loop must have actually pulled at least one frame").toBe(1);
    expect(
      cancelSpy,
      "breaking out of the subscription must cancel the underlying stream reader — releaseLock() alone leaves the fetch response (and its socket) open",
    ).toHaveBeenCalledTimes(1);
    expect(releaseLockCalls, "cleanup must still release the lock").toBeGreaterThanOrEqual(1);
  });
});

describe("WS transport — the underlying socket is closed on early exit", () => {
  class FakeSocket {
    public closeCalls = 0;
    private readonly listeners = new Map<string, Array<(ev: unknown) => void>>();
    addEventListener(type: string, fn: (ev: unknown) => void): void {
      const arr = this.listeners.get(type) ?? [];
      arr.push(fn);
      this.listeners.set(type, arr);
      if (type === "open") queueMicrotask(() => fn({}));
    }
    private emit(type: string, ev: unknown): void {
      for (const fn of this.listeners.get(type) ?? []) fn(ev);
    }
    send(): void {
      // Deliver one frame per send so the consumer always has something to read.
      queueMicrotask(() =>
        this.emit("message", { data: JSON.stringify({ type: "data", data: { tick: 1 } }) }),
      );
    }
    close(): void {
      this.closeCalls += 1;
      this.emit("close", {});
    }
  }

  it("test_breaking_out_of_for_await_closes_the_underlying_socket", async () => {
    const socket = new FakeSocket();
    function FakeSocketCtor(): FakeSocket {
      return socket;
    }
    const gen = subscribe<unknown, { tick: number }>(
      "feed",
      {},
      {
        baseUrl: BASE,
        transport: "ws",
        maxReconnectAttempts: 0,
        WebSocket: FakeSocketCtor as unknown as typeof WebSocket,
      },
    );

    let received = 0;
    for await (const _value of gen) {
      received += 1;
      break;
    }

    expect(received).toBe(1);
    expect(
      socket.closeCalls,
      "breaking out of the subscription must close the underlying WebSocket",
    ).toBeGreaterThanOrEqual(1);
  });
});
