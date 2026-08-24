/**
 * Types the socket failure `fetch` throws **before** any response exists.
 *
 * ## The hole this closes
 *
 * `mapAnthropicError` / `mapOpenAIError` only come into play when there is a `Response` — that is, for
 * **HTTP** errors. An ECONNREFUSED / ETIMEDOUT / DNS failure blows up at `await fetch(...)`, and until
 * M93 it propagated raw: `anthropic.ts` had no `try` at all, and `openai.ts` mapped **only** Ollama and
 * rethrew the rest (`throw fetchErr`).
 *
 * This matters because `isTransientError` — the SDK's single source of truth — returns `false` for
 * a foreign error **by contract** ("wrap a foreign error in the appropriate SDK error first",
 * `errors.ts:429`). With the transport letting the raw error escape, M93's retry would be dead
 * exactly the most classic failure it exists to cover. The same applied to the pool's
 * `classifyAndDecide`, which predates this milestone.
 *
 * ## Cancellation is NOT a transport failure
 *
 * `AbortError` also comes out of `fetch`, and wrapping it in a `NetworkError` (which is `isRetryable: true`)
 * would make an explicit user cancellation be retried three times. It propagates intact.
 *
 * @internal
 */
import { NetworkError, TheokitAgentError } from "../../errors.js";

/** Did the error come from an `abort()` rather than a network failure? */
function ehAbort(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const nome = (err as { name?: unknown }).name;
  return nome === "AbortError" || nome === "TimeoutError";
}

/**
 * Wraps a socket failure in a {@link NetworkError}, preserving the cause.
 *
 * Returns the original error — unwrapped — when it is an abort or already an SDK error.
 */
export function wrapTransportError(
  err: unknown,
  ctx: { providerId: string; endpoint: string },
): unknown {
  if (ehAbort(err)) return err;
  // Any SDK error already carries a mapped message and code — a provider's 429 or context-length
  // refusal must not be relabelled "transport failure" on its way out (#371 widened this from
  // `NetworkError` to the whole hierarchy when the SSE read started routing through here).
  if (err instanceof TheokitAgentError) return err;
  const detail = err instanceof Error ? err.message : String(err);
  return new NetworkError(`${ctx.providerId} transport failure on ${ctx.endpoint}: ${detail}`, {
    code: "transport_failure",
    cause: err,
  });
}
