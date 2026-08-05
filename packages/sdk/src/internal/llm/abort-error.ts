/**
 * The error to throw when an `AbortSignal` is already aborted.
 *
 * Extracted in M93 (adversarial review, L1) when this would have been the **third** copy — rule of 3.
 * `pool-aware-client.ts` and `fallback-client.ts` kept the same function with slightly different string
 * fallbacks; this version preserves the more informative of the two.
 *
 * Preferring `signal.reason` over a raw `new Error("aborted")` is what `error-handling.md` § 2 asks for: a
 * cancellation carries the canceller's reason, and replacing it with generic text erases the cause.
 *
 * @internal
 */
export function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  return new Error(signal.reason !== undefined ? String(signal.reason) : "aborted");
}
