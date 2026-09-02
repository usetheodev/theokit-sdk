/**
 * Generic retry wrapper (plan m0-foundation-expose-primitives, M0-3).
 *
 * Exponential backoff with full jitter, deterministically testable via an
 * injectable `sleep` and `rng` (no real timers in unit tests, per the repo
 * testing rule). The default `isRetryable` predicate is {@link isTransientError}
 * so SDK errors retry exactly as the SDK classifies them. The workflow-internal
 * `withRetry` (RetryPolicy-coupled) is intentionally separate (ADR-M0-3).
 *
 * @internal — public via `@theokit/sdk/retry`
 */

import { ConfigurationError, isTransientError } from "../../errors.js";

/** Options for {@link withRetry}. All fields optional; sensible defaults applied. */
export interface RetryOptions {
  /** Number of retries after the first attempt (total attempts = retries + 1). Default 3. */
  retries?: number;
  /** Predicate deciding whether a thrown error is worth retrying. Default {@link isTransientError}. */
  isRetryable?: (err: unknown) => boolean;
  /** Base backoff in ms for the first retry. Default 100. */
  initialDelayMs?: number;
  /** Upper bound for a single backoff sleep. Default 30_000. */
  maxDelayMs?: number;
  /** Exponential multiplier applied per retry. Default 2. */
  backoffMultiplier?: number;
  /** [0, 1) source for full-jitter. Default `Math.random`. Inject for deterministic tests. */
  rng?: () => number;
  /** Sleep function. Default a `setTimeout`-based abortable sleep. Inject for deterministic tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Abort signal; once aborted, the abortable default sleep rejects and the loop stops. */
  signal?: AbortSignal;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error("withRetry: aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("withRetry: aborted"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

interface ResolvedRetry {
  retries: number;
  isRetryable: (err: unknown) => boolean;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  rng: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
}

function resolveRetryOptions(options?: RetryOptions): ResolvedRetry {
  const retries = options?.retries ?? 3;
  if (!Number.isInteger(retries) || retries < 0) {
    throw new ConfigurationError(
      `withRetry: retries must be a non-negative integer, got ${retries}`,
      { code: "invalid_retry_config" },
    );
  }
  return {
    retries,
    isRetryable: options?.isRetryable ?? isTransientError,
    initialDelayMs: options?.initialDelayMs ?? 100,
    maxDelayMs: options?.maxDelayMs ?? 30_000,
    backoffMultiplier: options?.backoffMultiplier ?? 2,
    rng: options?.rng ?? Math.random,
    sleep: options?.sleep ?? defaultSleep,
    signal: options?.signal,
  };
}

/** Full-jitter backoff for the given (0-indexed) retry attempt. */
function backoffMs(cfg: ResolvedRetry, attempt: number): number {
  const ceiling = Math.min(cfg.maxDelayMs, cfg.initialDelayMs * cfg.backoffMultiplier ** attempt);
  return Math.floor(cfg.rng() * ceiling);
}

/**
 * Run `fn`, retrying transient failures with exponential backoff + full jitter.
 *
 * @returns the resolved value of the first successful `fn()` call
 * @throws the last error when retries are exhausted or the error is not retryable
 *
 * @example
 *   const data = await withRetry(() => fetchJson(url)); // retries rate-limit/network
 */
export async function withRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T> {
  const cfg = resolveRetryOptions(options);
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= cfg.retries || !cfg.isRetryable(err)) throw err;
      await cfg.sleep(backoffMs(cfg, attempt), cfg.signal);
      attempt += 1;
    }
  }
}
