/**
 * G8 T2.2 — SubscriptionRuntime register + dispatch.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineSubscription } from "../../src/subscription/define-subscription.js";
import {
  SubscriptionRuntime,
  type WireFrame,
} from "../../src/subscription/internal/subscription-runtime.js";
import { SubscriptionError, SubscriptionInputError } from "../../src/subscription/types.js";

async function readSse(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value !== undefined) chunks.push(value);
  }
  const total = chunks.reduce((acc, c) => acc + c.byteLength, 0);
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(merged);
}

async function readWs(iter: AsyncIterable<WireFrame>): Promise<WireFrame[]> {
  const out: WireFrame[] = [];
  for await (const f of iter) out.push(f);
  return out;
}

describe("SubscriptionRuntime register/get", () => {
  it("registers + retrieves a descriptor", () => {
    const rt = new SubscriptionRuntime();
    const desc = defineSubscription({
      input: z.object({}),
      output: z.object({}),
      // eslint-disable-next-line require-yield
      async *handler() {
        return;
      },
    });
    rt.register("foo", desc);
    expect(rt.get("foo")).toBe(desc);
  });

  it("throws on duplicate register", () => {
    const rt = new SubscriptionRuntime();
    const desc = defineSubscription({
      input: z.object({}),
      output: z.object({}),
      // eslint-disable-next-line require-yield
      async *handler() {
        return;
      },
    });
    rt.register("foo", desc);
    expect(() => rt.register("foo", desc)).toThrow(SubscriptionError);
  });

  it("unregister removes the entry", () => {
    const rt = new SubscriptionRuntime();
    const desc = defineSubscription({
      input: z.object({}),
      output: z.object({}),
      // eslint-disable-next-line require-yield
      async *handler() {
        return;
      },
    });
    rt.register("foo", desc);
    expect(rt.unregister("foo")).toBe(true);
    expect(rt.get("foo")).toBeUndefined();
  });
});

describe("SubscriptionRuntime dispatch (SSE)", () => {
  it("emits connected, message, end events for 2-item stream", async () => {
    const rt = new SubscriptionRuntime();
    rt.register(
      "counter",
      defineSubscription({
        input: z.object({ from: z.number() }),
        output: z.object({ n: z.number() }),
        async *handler(input) {
          yield { n: input.from };
          yield { n: input.from + 1 };
        },
      }),
    );
    const ac = new AbortController();
    const result = rt.dispatch({
      name: "counter",
      rawInput: { from: 10 },
      transport: "sse",
      connectionId: "conn-1",
      signal: ac.signal,
      disconnect: () => ac.abort(),
    });
    expect(result.transport).toBe("sse");
    const body = await readSse((result as { transport: "sse"; stream: ReadableStream<Uint8Array> }).stream);
    expect(body).toContain("event: connected");
    expect(body).toContain('data: {"n":10}');
    expect(body).toContain('data: {"n":11}');
    expect(body).toContain("event: end");
  });

  it("emits tracked envelope with id: field", async () => {
    const rt = new SubscriptionRuntime();
    rt.register(
      "tracked-stream",
      defineSubscription({
        input: z.object({}),
        output: z.object({ msg: z.string() }),
        async *handler(_input, ctx) {
          yield ctx.tracked("id-a", { msg: "hello" });
        },
      }),
    );
    const ac = new AbortController();
    const result = rt.dispatch({
      name: "tracked-stream",
      rawInput: {},
      transport: "sse",
      connectionId: "conn-1",
      signal: ac.signal,
      disconnect: () => ac.abort(),
    });
    const body = await readSse((result as { transport: "sse"; stream: ReadableStream<Uint8Array> }).stream);
    expect(body).toContain("id: id-a");
    expect(body).toContain('data: {"msg":"hello"}');
  });

  it("rejects unknown subscription name", () => {
    const rt = new SubscriptionRuntime();
    expect(() =>
      rt.dispatch({
        name: "nope",
        rawInput: {},
        transport: "sse",
        connectionId: "x",
        signal: new AbortController().signal,
        disconnect: () => {},
      }),
    ).toThrow(SubscriptionError);
  });

  it("rejects invalid input with SubscriptionInputError", () => {
    const rt = new SubscriptionRuntime();
    rt.register(
      "typed",
      defineSubscription({
        input: z.object({ n: z.number() }),
        output: z.object({}),
        // eslint-disable-next-line require-yield
        async *handler() {
          return;
        },
      }),
    );
    expect(() =>
      rt.dispatch({
        name: "typed",
        rawInput: { n: "not-a-number" },
        transport: "sse",
        connectionId: "x",
        signal: new AbortController().signal,
        disconnect: () => {},
      }),
    ).toThrow(SubscriptionInputError);
  });

  it("forwards lastEventId via ctx", async () => {
    const rt = new SubscriptionRuntime();
    let captured: string | undefined = "<not-called>";
    rt.register(
      "echo-cursor",
      defineSubscription({
        input: z.object({}),
        output: z.object({ cursor: z.string().optional() }),
        async *handler(_input, ctx) {
          captured = ctx.lastEventId;
          yield { cursor: ctx.lastEventId ?? "none" };
        },
      }),
    );
    const ac = new AbortController();
    const result = rt.dispatch({
      name: "echo-cursor",
      rawInput: {},
      transport: "sse",
      lastEventId: "id-99",
      connectionId: "x",
      signal: ac.signal,
      disconnect: () => ac.abort(),
    });
    await readSse((result as { transport: "sse"; stream: ReadableStream<Uint8Array> }).stream);
    expect(captured).toBe("id-99");
  });
});

describe("SubscriptionRuntime dispatch (WS)", () => {
  it("yields data + tracked + end frames", async () => {
    const rt = new SubscriptionRuntime();
    rt.register(
      "ws-stream",
      defineSubscription({
        input: z.object({}),
        output: z.object({ n: z.number() }),
        async *handler(_input, ctx) {
          yield { n: 1 };
          yield ctx.tracked("id-x", { n: 2 });
        },
      }),
    );
    const ac = new AbortController();
    const result = rt.dispatch({
      name: "ws-stream",
      rawInput: {},
      transport: "ws",
      connectionId: "ws-conn",
      signal: ac.signal,
      disconnect: () => ac.abort(),
    });
    expect(result.transport).toBe("ws");
    const frames = await readWs((result as { transport: "ws"; iterable: AsyncIterable<WireFrame> }).iterable);
    expect(frames).toEqual([
      { type: "data", data: { n: 1 } },
      { type: "tracked", id: "id-x", data: { n: 2 } },
      { type: "end" },
    ]);
  });

  it("emits error frame when handler throws", async () => {
    const rt = new SubscriptionRuntime();
    rt.register(
      "throws",
      defineSubscription({
        input: z.object({}),
        output: z.object({}),
        // eslint-disable-next-line require-yield
        async *handler() {
          throw new Error("boom");
        },
      }),
    );
    const ac = new AbortController();
    const result = rt.dispatch({
      name: "throws",
      rawInput: {},
      transport: "ws",
      connectionId: "x",
      signal: ac.signal,
      disconnect: () => ac.abort(),
    });
    const frames = await readWs((result as { transport: "ws"; iterable: AsyncIterable<WireFrame> }).iterable);
    expect(frames[0]).toEqual({ type: "error", error: { message: "boom" } });
  });
});

describe("SubscriptionRuntime active connection count", () => {
  it("increments + decrements around dispatch lifecycle", async () => {
    const rt = new SubscriptionRuntime();
    rt.register(
      "noop",
      defineSubscription({
        input: z.object({}),
        output: z.object({}),
        async *handler() {
          yield {};
        },
      }),
    );
    expect(rt.getActiveConnectionCount()).toBe(0);
    const ac = new AbortController();
    const result = rt.dispatch({
      name: "noop",
      rawInput: {},
      transport: "ws",
      connectionId: "x",
      signal: ac.signal,
      disconnect: () => ac.abort(),
    });
    // Connection counted during iteration
    expect(rt.getActiveConnectionCount()).toBe(1);
    await readWs((result as { transport: "ws"; iterable: AsyncIterable<WireFrame> }).iterable);
    expect(rt.getActiveConnectionCount()).toBe(0);
  });
});
