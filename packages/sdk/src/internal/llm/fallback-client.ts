import { AuthenticationError, NetworkError, RateLimitError } from "../../errors.js";
import type { LlmClient, LlmEvent, LlmFinish, LlmRequest } from "./types.js";

/**
 * Chain-aware `LlmClient` wrapper (ADR D2 — provider fallback failover).
 *
 * On every `stream()`, tries each underlying client in order. When the first
 * `.next()` of a client's generator throws `NetworkError`, the wrapper logs
 * a diagnostic and tries the next client. Once the first event has yielded
 * from a client, the failover is OFF for that generator — partial output
 * would corrupt the stream.
 *
 * Per edge-case review EC-3, the wrapper checks `signal.aborted` BEFORE
 * iterating to the next client so a caller-side cancellation does not burn
 * a fallback HTTP round-trip.
 *
 * When every client fails, the LAST `NetworkError` is re-thrown so the
 * caller still receives a typed error.
 *
 * @internal
 */
export class FallbackLlmClient implements LlmClient {
  readonly name = "fallback";

  constructor(private readonly clients: ReadonlyArray<LlmClient>) {}

  async *stream(
    request: LlmRequest,
    signal: AbortSignal,
  ): AsyncGenerator<LlmEvent, LlmFinish, void> {
    let lastError: NetworkError | undefined;
    for (const client of this.clients) {
      if (signal.aborted) throw abortError(signal);
      const attempt = await tryFirstEvent(client, request, signal);
      if (attempt.kind === "handshake_error") {
        lastError = attempt.error;
        continue;
      }
      return yield* relay(attempt.generator, attempt.firstResult);
    }
    if (lastError !== undefined) throw lastError;
    throw new NetworkError("FallbackLlmClient has no providers configured", {
      code: "fallback_empty_chain",
    });
  }
}

type AttemptResult =
  | {
      kind: "ok";
      generator: AsyncGenerator<LlmEvent, LlmFinish, void>;
      firstResult: IteratorResult<LlmEvent, LlmFinish>;
    }
  | { kind: "handshake_error"; error: NetworkError };

async function tryFirstEvent(
  client: LlmClient,
  request: LlmRequest,
  signal: AbortSignal,
): Promise<AttemptResult> {
  const generator = client.stream(request, signal);
  try {
    const firstResult = await generator.next();
    return { kind: "ok", generator, firstResult };
  } catch (cause) {
    // Post-T2.1 refinement: provider-mapped errors may surface as
    // AuthenticationError (401/403) or RateLimitError (429) instead of
    // NetworkError. All three categories indicate a provider-side
    // pre-stream failure where falling back to the next provider is
    // sensible (different provider → different key / no rate limit).
    if (
      cause instanceof NetworkError ||
      cause instanceof RateLimitError ||
      cause instanceof AuthenticationError
    ) {
      const errCode = cause.metadata?.code ?? cause.code ?? "unknown";
      process.stderr.write(
        `[theokit-sdk] provider ${client.name} failed (${errCode}): falling back\n`,
      );
      return { kind: "handshake_error", error: cause };
    }
    throw cause;
  }
}

async function* relay(
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

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  return new Error(signal.reason !== undefined ? String(signal.reason) : "aborted");
}
