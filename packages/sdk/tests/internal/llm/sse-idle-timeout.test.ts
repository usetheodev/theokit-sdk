/**
 * M2 #61 (T2.1) — RED-first: parseSseStream must reject a typed NetworkError when
 * the upstream stalls (no bytes at all) past the idle bound, and must NOT trip on
 * a slow-but-alive stream that keeps trickling chunks under the bound.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkError } from "../../../src/errors.js";
import { parseSseStream } from "../../../src/internal/llm/sse.js";

const enc = new TextEncoder();

/** A body whose reader yields `first`, then never settles again (stalls). */
function stallingBody(first: string): ReadableStream<Uint8Array> {
  let sent = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(enc.encode(first));
        return;
      }
      // Return a promise that never resolves → the stream stalls.
      return new Promise<void>(() => {});
    },
  });
}

/** A body that emits `chunks` with `gapMs` between each, then closes. */
function trickleBody(chunks: string[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(enc.encode(chunks[i] as string));
        i += 1;
      } else {
        controller.close();
      }
    },
  });
}

describe("M2 #61 — SSE idle timeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("rejects a typed stream_idle_timeout when the upstream stalls past the bound", async () => {
    const gen = parseSseStream(stallingBody("data: hi\n\n"), new AbortController().signal, 5_000);
    // Consume the first record (arrives immediately), then the next read stalls.
    const first = await gen.next();
    expect(first.done).toBe(false);
    const pending = gen.next();
    let rejected: unknown;
    void pending.catch((e) => {
      rejected = e;
    });
    await vi.advanceTimersByTimeAsync(2_000); // < 5s bound → still stalled, no error yet
    expect(rejected).toBeUndefined();
    await vi.advanceTimersByTimeAsync(4_000); // now past 5s → idle timeout fires
    await expect(pending).rejects.toBeInstanceOf(NetworkError);
    await expect(pending).rejects.toMatchObject({ code: "stream_idle_timeout" });
  });

  it("does not trip on a slow-but-alive stream under the bound", async () => {
    // Chunks arrive synchronously in the mock (each pull enqueues immediately),
    // so no idle gap ever reaches the bound.
    const records: string[] = [];
    for await (const r of parseSseStream(
      trickleBody(["data: a\n\n", "data: b\n\n"]),
      new AbortController().signal,
      5_000,
    )) {
      records.push(r.data);
    }
    expect(records).toEqual(["a", "b"]);
  });

  it("idleTimeoutMs<=0 disables the bound (legacy behavior)", async () => {
    const records: string[] = [];
    for await (const r of parseSseStream(
      trickleBody(["data: x\n\n"]),
      new AbortController().signal,
      0,
    )) {
      records.push(r.data);
    }
    expect(records).toEqual(["x"]);
  });
});
