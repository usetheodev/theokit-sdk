/**
 * Shared streaming helpers for `LlmClient` wrappers
 * (`FallbackLlmClient`, `PoolAwareLlmClient`).
 *
 * `tryFirstEvent` probes the first chunk of a stream to decide
 * whether the handshake succeeded. If it raises an
 * `AuthenticationError`/`RateLimitError`/`NetworkError`, the wrapper
 * captures the typed error for routing (rotate vs fallback) WITHOUT
 * starting the actual yield. Once the first event lands, the stream
 * is committed and partial-output cannot be reverted.
 *
 * `relay` yields the prefetched first chunk and then forwards the
 * remaining generator output verbatim.
 *
 * @internal
 */

import { AuthenticationError, NetworkError, RateLimitError } from "../../errors.js";
import type { LlmClient, LlmEvent, LlmFinish, LlmRequest } from "./types.js";

/**
 * Outcome of probing a client's first stream event.
 *
 * @internal
 */
export type StreamAttempt =
  | {
      kind: "ok";
      generator: AsyncGenerator<LlmEvent, LlmFinish, void>;
      firstResult: IteratorResult<LlmEvent, LlmFinish>;
    }
  | { kind: "handshake_error"; error: RateLimitError | AuthenticationError | NetworkError };

/**
 * Try to obtain the FIRST event from `client.stream(...)`. Typed
 * provider failures surface as `kind: "handshake_error"`; everything
 * else propagates upward unchanged.
 *
 * Optionally writes a `[theokit-sdk] provider X failed (CODE): falling back`
 * line to stderr when `logFallback` is true — used by `FallbackLlmClient`.
 *
 * @internal
 */
export async function tryFirstEvent(
  client: LlmClient,
  request: LlmRequest,
  signal: AbortSignal,
  logFallback = false,
): Promise<StreamAttempt> {
  const generator = client.stream(request, signal);
  try {
    const firstResult = await generator.next();
    return { kind: "ok", generator, firstResult };
  } catch (cause) {
    if (
      cause instanceof NetworkError ||
      cause instanceof RateLimitError ||
      cause instanceof AuthenticationError
    ) {
      if (logFallback) {
        const errCode = cause.metadata?.code ?? cause.code ?? "unknown";
        process.stderr.write(
          `[theokit-sdk] provider ${client.name} failed (${errCode}): falling back\n`,
        );
      }
      return { kind: "handshake_error", error: cause };
    }
    throw cause;
  }
}

/**
 * Yield the prefetched first event, then forward the rest of the
 * generator. Identical to a normal `yield*` but with the lookahead
 * already in hand from `tryFirstEvent`.
 *
 * @internal
 */
export async function* relayStream(
  generator: AsyncGenerator<LlmEvent, LlmFinish, void>,
  firstResult: IteratorResult<LlmEvent, LlmFinish>,
): AsyncGenerator<LlmEvent, LlmFinish, void> {
  if (firstResult.done === true) return firstResult.value;
  yield firstResult.value;
  while (true) {
    const next = await generator.next();
    if (next.done === true) return next.value;
    yield next.value;
  }
}
