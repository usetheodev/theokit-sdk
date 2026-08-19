/**
 * B-050, top concentration — the seven `throw new` sites in `subscription/theokit-subscribe.ts` that a
 * fresh whole-suite lcov reports at count 0. The file sat at 43/127 lines with no dedicated test file,
 * and `subscribe` is `@public`: these are refusals a consumer meets, not internal guards.
 *
 * Every test asserts the CODE. `SubscriptionDisconnectError extends SubscriptionError`, so
 * `toThrow(SubscriptionError)` passes for both and cannot tell "the server refused" from "the
 * connection died" — the same subclass trap that let a drop-in replacement survive every mutant in an
 * earlier batch of this campaign.
 *
 * `fetch` and `WebSocket` are read off `globalThis` rather than injected, so the tests replace them for
 * their own duration. Injection would be the better design and is deliberately NOT done here: changing
 * a `@public` signature to make it testable is a production change smuggled into a coverage batch.
 * Recorded as B-108 instead.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { subscribe } from "../../src/subscription/theokit-subscribe.js";
import { SubscriptionDisconnectError, SubscriptionError } from "../../src/subscription/types.js";

afterEach(() => vi.unstubAllGlobals());

const BASE = "https://api.test";

/** Drains the generator far enough to surface the first refusal. */
async function firstError(gen: AsyncGenerator<unknown, void, void>): Promise<unknown> {
  return gen.next().then(
    () => null,
    (e: unknown) => e,
  );
}

/** Asserts the refusal carries `code` — the field a caller branches on. */
function expectCode(err: unknown, code: string): SubscriptionError {
  expect(err).toBeInstanceOf(SubscriptionError);
  expect((err as SubscriptionError & { code?: string }).code, "the code a caller switches on").toBe(
    code,
  );
  return err as SubscriptionError;
}

/** An SSE response whose body streams the given raw frames. */
function sseResponse(frames: string[], init: { ok?: boolean; status?: number } = {}) {
  const encoder = new TextEncoder();
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.status === 503 ? "Service Unavailable" : "OK",
    body:
      init.ok === false
        ? null
        : new ReadableStream<Uint8Array>({
            start(controller) {
              for (const f of frames) controller.enqueue(encoder.encode(f));
              controller.close();
            },
          }),
  } as unknown as Response;
}

describe("the argument guards — refusals before any connection is attempted", () => {
  it("test_an_empty_name_is_refused_before_any_connection", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const err = await firstError(subscribe("", {}, { baseUrl: BASE }));

    expectCode(err, "subscribe_name_invalid");
    expect(
      fetchSpy,
      "a guard that runs after the connection is not a guard",
    ).not.toHaveBeenCalled();
  });

  it("test_a_missing_base_url_is_refused_before_any_connection", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const err = await firstError(subscribe("feed", {}, {} as unknown as { baseUrl: string }));

    expectCode(err, "subscribe_baseUrl_missing");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("the SSE transport", () => {
  it("test_a_non_2xx_subscribe_response_is_a_typed_error", async () => {
    vi.stubGlobal("fetch", async () => sseResponse([], { ok: false, status: 503 }));

    const err = await firstError(
      subscribe("feed", {}, { baseUrl: BASE, transport: "sse", maxReconnectAttempts: 0 }),
    );

    const e = expectCode(err, "sse_http_error");
    expect(e.message, "the status is what tells an operator which half failed").toContain("503");
  });

  it("test_an_error_frame_mid_stream_is_a_typed_error", async () => {
    // The interesting one: it arrives as a well-formed SSE frame, so nothing but the `event:` name
    // distinguishes it from data.
    vi.stubGlobal("fetch", async () => sseResponse(["event: error\ndata: handler exploded\n\n"]));

    const err = await firstError(
      subscribe("feed", {}, { baseUrl: BASE, transport: "sse", maxReconnectAttempts: 0 }),
    );

    const e = expectCode(err, "sse_server_error");
    expect(e.message).toContain("handler exploded");
  });
});

describe("the WebSocket transport", () => {
  it("test_ws_transport_without_a_global_websocket_names_the_remedy", async () => {
    // Pure diagnostics: this message is the entire product of this branch, and it is what a user on an
    // older runtime reads. Diagnostics nobody has read are diagnostics nobody has checked.
    vi.stubGlobal("WebSocket", undefined);

    const err = await firstError(
      subscribe("feed", {}, { baseUrl: BASE, transport: "ws", maxReconnectAttempts: 0 }),
    );

    const e = expectCode(err, "ws_global_missing");
    expect(e.message, "must name the runtime that has it").toContain("Node >=22");
    // Review: `toContain("ws")` was near-tautological — the message begins with the literal
    // `Theokit.subscribe(transport='ws')`, so the prefix alone satisfied it. Deleting the entire
    // remedy clause left the test green. The test's name promises the whole remedy; assert the half
    // that was unconstrained.
    expect(e.message, "and the package that supplies it otherwise").toContain("install 'ws'");
  });

  it("test_a_ws_error_frame_is_a_typed_error", async () => {
    // A fake socket implementing what the module ACTUALLY reads, which my first version got wrong:
    // `openWs` uses `addEventListener`, not `onmessage`/`onopen` properties. The property-based fake
    // delivered nothing, the socket read as closed, and the test failed with
    // `subscription_disconnected` — a plausible-looking wrong result that says nothing about the
    // branch under test. The plan's own risk table named this and I still walked into it; the fix is
    // to read the source's dereferences rather than assume the DOM shape.
    //
    // Contract used by the module: addEventListener for open/message/close/error, then `send` after
    // the open handshake resolves, and `close`.
    class FakeSocket {
      private readonly listeners = new Map<string, Array<(ev: unknown) => void>>();
      addEventListener(type: string, fn: (ev: unknown) => void): void {
        const arr = this.listeners.get(type) ?? [];
        arr.push(fn);
        this.listeners.set(type, arr);
        // The handshake is awaited before `send`, so "open" must arrive asynchronously — firing it
        // synchronously here would resolve a promise nobody is listening on yet.
        if (type === "open") queueMicrotask(() => fn({}));
      }
      private emit(type: string, ev: unknown): void {
        for (const fn of this.listeners.get(type) ?? []) fn(ev);
      }
      send(): void {
        // The module sends its subscribe frame after the handshake; answering with the error frame
        // here is what a server rejecting the subscription looks like.
        queueMicrotask(() =>
          this.emit("message", {
            data: JSON.stringify({ type: "error", error: { message: "server said no" } }),
          }),
        );
      }
      close(): void {
        this.emit("close", {});
      }
    }

    vi.stubGlobal("WebSocket", FakeSocket);

    const err = await firstError(
      subscribe("feed", {}, { baseUrl: BASE, transport: "ws", maxReconnectAttempts: 0 }),
    );

    const e = expectCode(err, "ws_server_error");
    expect(e.message).toContain("server said no");
  });
});

describe("reconnect exhaustion — two exits that mean different things", () => {
  it("test_a_disconnect_past_the_attempt_limit_is_a_disconnect_error", async () => {
    // A transport failure that is NOT a SubscriptionError must be wrapped, so the caller can tell a
    // dead connection from a server refusal.
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });

    const err = await firstError(
      subscribe("feed", {}, { baseUrl: BASE, transport: "sse", maxReconnectAttempts: 0 }),
    );

    expect(err).toBeInstanceOf(SubscriptionDisconnectError);
    expect((err as Error).message).toContain("reconnect exhausted");
  });

  it("test_a_subscription_error_survives_the_reconnect_wrapper_unchanged", async () => {
    // The other exit. `SubscriptionDisconnectError extends SubscriptionError`, so asserting the class
    // alone cannot separate these two tests — the code is what does it.
    vi.stubGlobal("fetch", async () => sseResponse([], { ok: false, status: 503 }));

    const err = await firstError(
      subscribe("feed", {}, { baseUrl: BASE, transport: "sse", maxReconnectAttempts: 0 }),
    );

    expectCode(err, "sse_http_error");
    expect(
      err,
      "a typed server refusal must reach the caller as itself, not wrapped as a disconnect",
    ).not.toBeInstanceOf(SubscriptionDisconnectError);
  });
});
