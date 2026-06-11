/**
 * T3.4 — exponential backoff with full jitter for credential-pool retry.
 *
 * Why we need this: pre-T3.4 `pool-aware-client.ts:79-83` retried the
 * SAME credential immediately on the first 429 without any wait. When
 * every credential in the pool returned 429 (thundering herd against a
 * shared quota), the client burned through all 5 retry attempts in <1ms,
 * tripped `CredentialPoolExhaustedError`, and surfaced to the agent loop
 * as a hard failure. The user-visible symptom was "all my keys are
 * exhausted!" when in reality a 1-2s wait would have cleared the rate
 * limit.
 *
 * AWS Architecture Blog "Exponential Backoff And Jitter" (Marc Brooker,
 * 2015) demonstrates full jitter as the canonical pattern: `sleep =
 * random_between(0, base * 2^attempt)`. We extend it with a hard cap
 * (so a 32s sleep never blocks an interactive agent) and honor the
 * provider's `Retry-After` hint when present — the hint always wins over
 * the computed value when it falls within `[base, cap]`.
 *
 * @internal
 */

export interface BackoffOptions {
  /** 0-indexed retry attempt number. */
  attempt: number;
  /** Base delay in ms (multiplier for 2^attempt). Default 500. */
  baseMs?: number;
  /** Hard cap in ms — backoff never sleeps longer than this. Default 32_000. */
  capMs?: number;
  /** Provider's Retry-After hint in ms (from header). Takes precedence when in-range. */
  retryAfterMs?: number;
  /** Random source — pass a deterministic mock from tests. Default `Math.random`. */
  rng?: () => number;
}

const DEFAULT_BASE_MS = 500;
const DEFAULT_CAP_MS = 32_000;

/**
 * Compute the next sleep duration (ms) before retrying a failed request.
 *
 * Algorithm:
 * 1. If `retryAfterMs` is set, prefer it — clamped to `[baseMs, capMs]`.
 *    The provider's hint is the most accurate available signal.
 * 2. Otherwise: `sleep = random(0, min(cap, base * 2^attempt))` — full
 *    jitter per Brooker 2015 ensures coordinated clients (each with
 *    different RNG seeds) spread the retry storm.
 *
 * @internal
 */
export function computeBackoffMs(opts: BackoffOptions): number {
  const base = opts.baseMs ?? DEFAULT_BASE_MS;
  const cap = opts.capMs ?? DEFAULT_CAP_MS;
  const rng = opts.rng ?? Math.random;
  if (opts.retryAfterMs !== undefined && opts.retryAfterMs >= 0) {
    return Math.max(base, Math.min(cap, opts.retryAfterMs));
  }
  const ceiling = Math.min(cap, base * 2 ** opts.attempt);
  return Math.floor(rng() * ceiling);
}

/**
 * `setTimeout`-based sleep that resolves early when the abort signal fires.
 * Resolves cleanly (does not throw on abort) so callers decide how to
 * react to the abort downstream.
 *
 * @internal
 */
export function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
