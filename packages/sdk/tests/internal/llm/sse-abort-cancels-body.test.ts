/**
 * T3.2 — when an SSE consumer aborts via the `AbortSignal`, the parser
 * MUST cancel the underlying body stream so the HTTP connection's TCP
 * socket actually closes. Pre-T3.2 the parser only released the reader
 * lock — the body kept draining in the background, leaving CLOSE_WAIT
 * sockets to accumulate (T6.2 load test would fail).
 *
 * DR3 finding #2. Wire-level proof in T6.2 (1000 conn p95 + `ss -tnp`);
 * here we proxy via an in-memory `ReadableStream.cancel` observer.
 */

import { describe, expect, it } from "vitest";

import { parseSseStream } from "../../../src/internal/llm/sse.js";

interface ObservedStream {
  stream: ReadableStream<Uint8Array>;
  cancelled: () => boolean;
}

function makeNeverEndingStream(initialChunks: string[] = []): ObservedStream {
  let cancelCalled = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of initialChunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      // After initial chunks, the producer simply stops — it never closes
      // the controller. The consumer is responsible for cancelling.
    },
    cancel(_reason) {
      cancelCalled = true;
    },
  });
  return { stream, cancelled: () => cancelCalled };
}

describe("T3.2 — SSE abort cancels the body stream", () => {
  it("aborting the signal causes ReadableStream.cancel to be invoked", async () => {
    const { stream, cancelled } = makeNeverEndingStream(["data: hello\n\n"]);
    const controller = new AbortController();
    const gen = parseSseStream(stream, controller.signal);

    // Consume the first record to enter the reader.read loop.
    const first = await gen.next();
    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({ data: "hello" });

    // Abort and drain the generator. Post-T3.2 the body MUST be cancelled.
    controller.abort();
    // The consumer pulls one more time so the parser observes the abort.
    const next = await gen.next();
    expect(next.done).toBe(true);

    expect(cancelled()).toBe(true);
  });

  it("ending the stream normally does NOT call cancel", async () => {
    let cancelCalled = false;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: bye\n\n"));
        controller.close();
      },
      cancel() {
        cancelCalled = true;
      },
    });
    const controller = new AbortController();
    const out: Array<{ data: string }> = [];
    for await (const r of parseSseStream(stream, controller.signal)) {
      out.push(r);
    }
    expect(out).toHaveLength(1);
    expect(out[0]?.data).toBe("bye");
    expect(cancelCalled).toBe(false);
  });
});
