/**
 * T3.3 — when an SSE/streaming consumer BREAKS the for-await loop (early
 * exit on `[DONE]` sentinel, satisfied stop condition, etc.) the body
 * stream MUST be cancelled too — not only on AbortSignal (T3.2).
 *
 * Without this, providers that stream multi-second responses leave the
 * HTTP body in CLOSE_WAIT every time the consumer breaks early — same
 * socket-leak shape as T3.2 but triggered by a different code path.
 *
 * Plan T3.3: `internal/llm/openai.ts:140-150` + `internal/llm/anthropic.ts:108`
 * + `internal/llm/bedrock-anthropic.ts:85` wrap the `for await` in try /
 * finally so the underlying parseSseStream's generator gets `.return()`
 * called explicitly, which runs its finally (cancels the body via T3.2).
 *
 * This test proxies via a small for-await + break to assert the contract
 * at the parseSseStream level. Wire-level proof for the real
 * openai.ts/anthropic.ts paths via the per-iter `tests/load/` smoke.
 */

import { describe, expect, it } from "vitest";

import { parseSseStream } from "../../../src/internal/llm/sse.js";

describe("T3.3 — SSE break cancels the body stream", () => {
  it("for-await + early break triggers ReadableStream.cancel", async () => {
    let cancelCalled = false;
    const encoder = new TextEncoder();
    // Stream emits 3 events then waits indefinitely (never closes).
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: 1\n\n"));
        controller.enqueue(encoder.encode("data: 2\n\n"));
        controller.enqueue(encoder.encode("data: 3\n\n"));
        // intentionally do NOT close — consumer must cancel on break.
      },
      cancel() {
        cancelCalled = true;
      },
    });

    const seen: string[] = [];
    for await (const r of parseSseStream(stream, new AbortController().signal)) {
      seen.push(r.data);
      if (r.data === "2") break;
    }

    expect(seen).toEqual(["1", "2"]);
    expect(cancelCalled).toBe(true);
  });

  it("for-await + throw inside the loop also triggers ReadableStream.cancel", async () => {
    let cancelCalled = false;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: 1\n\n"));
        controller.enqueue(encoder.encode("data: 2\n\n"));
        // never close
      },
      cancel() {
        cancelCalled = true;
      },
    });

    await expect(async () => {
      for await (const _r of parseSseStream(stream, new AbortController().signal)) {
        throw new Error("consumer-throw");
      }
    }).rejects.toThrow("consumer-throw");

    expect(cancelCalled).toBe(true);
  });
});
