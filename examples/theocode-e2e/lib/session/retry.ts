export interface RetryOptions {
  /** Must be >= 1. If < 1, throws immediately without calling fn. */
  maxAttempts: number;
  /** Base delay in ms (default 1000). */
  baseDelayMs?: number;
  /** Maximum delay cap in ms (default 30000). */
  maxDelayMs?: number;
  /** Predicate to decide if an error is retryable. Defaults to always-true. */
  isRetryable?: (error: unknown) => boolean;
}

export interface RetryableError {
  retryAfterMs?: number;
}

/**
 * Retries `fn` with exponential backoff.
 *
 * - Honors `retryAfterMs` on errors that provide it.
 * - If `maxAttempts < 1`, throws without calling fn (EC-3).
 * - Non-retryable errors are re-thrown immediately.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: retry logic with backoff
export async function retryWithBackoff<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const { maxAttempts, baseDelayMs = 1000, maxDelayMs = 30_000, isRetryable = () => true } = opts;

  if (maxAttempts < 1) {
    throw new Error("maxAttempts must be >= 1");
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;

      if (!isRetryable(error)) throw error;
      if (attempt === maxAttempts) break;

      const retryAfter = getRetryAfterMs(error);
      const exponentialDelay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const delay = retryAfter ?? exponentialDelay;

      await sleep(delay);
    }
  }

  throw lastError;
}

function getRetryAfterMs(error: unknown): number | undefined {
  if (
    error !== null &&
    typeof error === "object" &&
    "retryAfterMs" in error &&
    typeof (error as RetryableError).retryAfterMs === "number"
  ) {
    return (error as RetryableError).retryAfterMs;
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
