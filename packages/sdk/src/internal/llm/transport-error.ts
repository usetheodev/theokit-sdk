/**
 * Types the socket failure `fetch` throws **before** any response exists.
 *
 * ## O buraco que isto fecha
 *
 * `mapAnthropicError` / `mapOpenAIError` only come into play when there is a `Response` — that is, for
 * **HTTP** errors. An ECONNREFUSED / ETIMEDOUT / DNS failure blows up at `await fetch(...)`, and until
 * M93 it propagated raw: `anthropic.ts` had no `try` at all, and `openai.ts` mapped **only** Ollama and
 * rethrew the rest (`throw fetchErr`).
 *
 * This matters because `isTransientError` — the SDK's single source of truth — returns `false` for
 * erro estrangeiro **por contrato** ("wrap a foreign error in the appropriate SDK error first",
 * `errors.ts:429`). Com o transporte deixando o erro cru escapar, o retry do M93 estaria morto
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
import { NetworkError } from "../../errors.js";

/** Did the error come from an `abort()` rather than a network failure? */
function ehAbort(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const nome = (err as { name?: unknown }).name;
  return nome === "AbortError" || nome === "TimeoutError";
}

/**
 * Envolve uma falha de socket num {@link NetworkError}, preservando a causa.
 *
 * Returns the original error — unwrapped — when it is an abort or already an SDK error.
 */
export function wrapTransportError(
  err: unknown,
  ctx: { providerId: string; endpoint: string },
): unknown {
  if (ehAbort(err)) return err;
  if (err instanceof NetworkError) return err;
  const detalhe = err instanceof Error ? err.message : String(err);
  return new NetworkError(`${ctx.providerId} transport failure on ${ctx.endpoint}: ${detalhe}`, {
    code: "transport_failure",
    cause: err,
  });
}
